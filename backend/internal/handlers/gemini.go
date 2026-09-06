package handlers

// The Gemini proposal relay (§5.5b): the one place in this codebase that talks to a third
// party, and the only reason it exists is that the device may not be able to run the model.
//
// Three decisions are baked into the shape of this file, and each is a claim on the Vault
// page that has to stay true of the code as written:
//
//  1. **The browser never talks to Google.** `connect-src 'self'` in nginx.conf is unchanged
//     — deliberately, the way §5.6 left it — so every request the app makes still goes to
//     its own origin. This handler is the hop, and it is the operator's own server.
//  2. **The key is the operator's and never leaves the server.** GEMINI_API_KEY is read from
//     the environment like JWT_SECRET is. It is never sent to a client, never logged, and
//     `GeminiStatus` answers *whether* there is one without ever saying what it is.
//  3. **Nothing is stored.** The audio is a request body that becomes an upstream request
//     body and is then garbage. There is no row, no file, and no log line carrying either
//     the note or the answer — which is what lets the settings copy say the recording is not
//     kept anywhere, on the device or here.
//
// What this handler deliberately does *not* do is understand the journal. It forwards a
// prompt and some audio and hands back the model's text. The schema in §5.2, the closed
// vocabularies, the repairs and the validator all stay on the client, where they already run
// for every other runtime — a second implementation of the contract in Go is a second thing
// to keep in step with `validate.js`, and the validator has to run client-side regardless
// (§5.2, last paragraph).

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
)

const (
	// The default endpoint. A field rather than a constant in the request path so the tests
	// can point it at an httptest server without a network.
	geminiDefaultEndpoint = "https://generativelanguage.googleapis.com"

	// Audio-in, JSON-out, and cheap enough to run on every check-in.
	geminiDefaultModel = "gemini-2.5-flash"

	// One note is at most a handful of thirty-second clips at 16 kHz mono, which is well
	// under a megabyte of WAV. The cap is generous enough that a long take is never refused
	// and small enough that this endpoint cannot be used to push a film through the server.
	maxGeminiAudioBase64 = 12 << 20

	// The whole body, including the prompt. The prompt is a few kilobytes of feelings and
	// tags; the slack is the audio's base64 plus JSON escaping.
	maxGeminiBodyBytes = maxGeminiAudioBase64 + (1 << 20)

	maxGeminiSystemRunes = 32000
	maxGeminiTextRunes   = 8000

	// A one-pass answer over half a minute of audio. Generous, because a refusal costs the
	// user the take, and bounded, because a hung upstream must not hold a connection open.
	geminiTimeout = 90 * time.Second
)

// What Gemini will accept inline, narrowed to what a recorder in this app can produce. WAV
// is what the web and the Android plugin both encode to (§4.2 gives us 16 kHz mono PCM, and
// a RIFF header is eight lines of client code); the rest are here because a future capture
// path that hands over the container it recorded should not need a server change.
var geminiAudioTypes = map[string]bool{
	"audio/wav":   true,
	"audio/x-wav": true,
	"audio/wave":  true,
	"audio/mpeg":  true,
	"audio/mp3":   true,
	"audio/aac":   true,
	"audio/ogg":   true,
	"audio/flac":  true,
	"audio/webm":  true,
	"audio/mp4":   true,
	"audio/aiff":  true,
}

// GeminiConfig is the relay's whole configuration. Zero value: switched off.
type GeminiConfig struct {
	APIKey   string
	Model    string
	Endpoint string
	Timeout  time.Duration
	// Client is the outbound client. Nil means "one with the configured timeout", which is
	// what production uses; the tests set it.
	Client *http.Client
}

// Enabled reports whether this build can reach Gemini at all. Everything user-facing hangs
// off this: the settings toggle is not offered when it is false, so the journal never
// advertises a path the operator did not turn on.
func (cfg GeminiConfig) Enabled() bool { return strings.TrimSpace(cfg.APIKey) != "" }

// EffectiveModel is the model this configuration would actually call — the configured one,
// or the default. What the status endpoint reports and what main logs at startup.
func (cfg GeminiConfig) EffectiveModel() string { return cfg.model() }

func (cfg GeminiConfig) model() string {
	if trimmed := strings.TrimSpace(cfg.Model); trimmed != "" {
		return trimmed
	}
	return geminiDefaultModel
}

func (cfg GeminiConfig) endpoint() string {
	if trimmed := strings.TrimSpace(cfg.Endpoint); trimmed != "" {
		return strings.TrimRight(trimmed, "/")
	}
	return geminiDefaultEndpoint
}

func (cfg GeminiConfig) timeout() time.Duration {
	if cfg.Timeout > 0 {
		return cfg.Timeout
	}
	return geminiTimeout
}

func (cfg GeminiConfig) client() *http.Client {
	if cfg.Client != nil {
		return cfg.Client
	}
	return &http.Client{Timeout: cfg.timeout()}
}

// geminiConfig is the process-wide configuration, written once at startup by LoadGemini.
var geminiConfig GeminiConfig

// LoadGemini reads the relay's configuration from the environment. Unlike auth.LoadSecret it
// cannot fail: an unset key is not a misconfiguration, it is the default deployment. The
// journal runs its models on the device, and this is the accelerator.
//
// It returns whether the relay came up, so main can say so once in the log — with no key in
// it — rather than leaving the operator to discover it from a 503 later.
func LoadGemini() bool {
	geminiConfig = GeminiConfig{
		APIKey:   strings.TrimSpace(os.Getenv("GEMINI_API_KEY")),
		Model:    strings.TrimSpace(os.Getenv("GEMINI_MODEL")),
		Endpoint: strings.TrimSpace(os.Getenv("GEMINI_ENDPOINT")),
	}
	return geminiConfig.Enabled()
}

// SetGeminiConfig replaces the process-wide configuration. For tests and for main.
func SetGeminiConfig(cfg GeminiConfig) { geminiConfig = cfg }

// GeminiSettings returns the current configuration.
func GeminiSettings() GeminiConfig { return geminiConfig }

/* The wire shapes: ours, then Google's */

type geminiAudioInput struct {
	MimeType string `json:"mime_type"`
	// Base64, without a `data:` prefix. It is forwarded as-is after validation, so the bytes
	// are never decoded here — nothing on this server has a reason to hold the audio.
	Data string `json:"data"`
}

type geminiProposeInput struct {
	// The system prompt, built by the client from the closed vocabularies (§5.3). It is the
	// client's because that is where the vocabularies live.
	System string `json:"system"`
	// The user turn: either the instruction that accompanies the audio, or the note itself
	// in text mode.
	Text  string            `json:"text"`
	Audio *geminiAudioInput `json:"audio"`
}

type geminiPart struct {
	Text       string            `json:"text,omitempty"`
	InlineData *geminiInlineData `json:"inline_data,omitempty"`
}

type geminiInlineData struct {
	MimeType string `json:"mime_type"`
	Data     string `json:"data"`
}

type geminiContent struct {
	Role  string       `json:"role,omitempty"`
	Parts []geminiPart `json:"parts"`
}

type geminiGenerationConfig struct {
	// Zero, for the same reason every local runtime passes `do_sample: false`: the same note
	// should get the same proposal, and §5.7's golden suite depends on it.
	Temperature float64 `json:"temperature"`
	// Gemini's own JSON mode. It is not the schema (§5.2 is enforced by the client's
	// validator, which has to run anyway), but it removes the fence and the prose that
	// `parseModelJson` otherwise has to repair.
	ResponseMimeType string `json:"response_mime_type"`
}

type geminiRequest struct {
	SystemInstruction *geminiContent         `json:"system_instruction,omitempty"`
	Contents          []geminiContent        `json:"contents"`
	GenerationConfig  geminiGenerationConfig `json:"generation_config"`
}

type geminiResponse struct {
	Candidates []struct {
		Content struct {
			Parts []struct {
				Text string `json:"text"`
			} `json:"parts"`
		} `json:"content"`
		FinishReason string `json:"finishReason"`
	} `json:"candidates"`
	PromptFeedback struct {
		BlockReason string `json:"blockReason"`
	} `json:"promptFeedback"`
	Error struct {
		Code    int    `json:"code"`
		Status  string `json:"status"`
		Message string `json:"message"`
	} `json:"error"`
}

/* The handlers */

// GeminiStatus answers whether this server can relay a proposal, and which model it would
// use. The settings screen asks before it offers the toggle, so a user is never given a
// switch that turns nothing on — the same rule the voice and index toggles follow.
//
// It says nothing about the key beyond whether one is set.
func GeminiStatus(c *gin.Context) {
	cfg := geminiConfig
	c.JSON(http.StatusOK, gin.H{
		"available": cfg.Enabled(),
		"model":     cfg.model(),
	})
}

// ProposeWithGemini forwards one note to Gemini and hands back what it said.
//
// The audio goes up as it was recorded — Gemini is natively multimodal, so there is no
// transcription step and no second model. What comes back is the model's raw text; the
// client parses and validates it exactly as it does for the on-device runtimes.
func ProposeWithGemini(c *gin.Context) {
	if _, ok := c.Get("userID"); !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User ID not found in context"})
		return
	}

	cfg := geminiConfig
	if !cfg.Enabled() {
		// 503 and not 404: the route exists, the operator has not given it a key. The client
		// turns its toggle off on this answer rather than showing a failed check-in.
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": "This server has no Gemini API key, so journal proposals are not relayed. " +
				"Set GEMINI_API_KEY to turn it on.",
		})
		return
	}

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxGeminiBodyBytes)

	var input geminiProposeInput
	if err := c.ShouldBindJSON(&input); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "That note is too long to send."})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	if err := validateGeminiInput(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	text, err := callGemini(c.Request.Context(), cfg, input)
	if err != nil {
		var upstream geminiUpstreamError
		if errors.As(err, &upstream) {
			c.JSON(upstream.status, gin.H{"error": upstream.message})
			return
		}
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "Gemini did not answer in time."})
			return
		}
		// The error itself is not echoed: a transport error can carry the URL, and the URL is
		// one query-string mistake away from carrying the key.
		c.JSON(http.StatusBadGateway, gin.H{"error": "Could not reach Gemini from this server."})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"text":  text,
		"model": cfg.model(),
	})
}

func validateGeminiInput(input *geminiProposeInput) error {
	input.System = strings.TrimSpace(input.System)
	input.Text = strings.TrimSpace(input.Text)

	if input.System == "" {
		return errors.New("system is required")
	}
	if utf8.RuneCountInString(input.System) > maxGeminiSystemRunes {
		return fmt.Errorf("system must be at most %d characters", maxGeminiSystemRunes)
	}
	if utf8.RuneCountInString(input.Text) > maxGeminiTextRunes {
		return fmt.Errorf("text must be at most %d characters", maxGeminiTextRunes)
	}

	if input.Audio == nil {
		if input.Text == "" {
			return errors.New("a note needs either audio or text")
		}
		return nil
	}

	input.Audio.MimeType = strings.ToLower(strings.TrimSpace(input.Audio.MimeType))
	// A parameterised type — `audio/wav; codecs=1` — is the same type.
	if semi := strings.IndexByte(input.Audio.MimeType, ';'); semi >= 0 {
		input.Audio.MimeType = strings.TrimSpace(input.Audio.MimeType[:semi])
	}
	if !geminiAudioTypes[input.Audio.MimeType] {
		return fmt.Errorf("unsupported audio type: %s", input.Audio.MimeType)
	}

	input.Audio.Data = strings.TrimSpace(input.Audio.Data)
	if input.Audio.Data == "" {
		return errors.New("audio carries no data")
	}
	if len(input.Audio.Data) > maxGeminiAudioBase64 {
		return errors.New("that recording is too long to send")
	}
	// Checked, not decoded. A body that is not base64 would be refused upstream anyway, and
	// finding that out here costs one pass over a megabyte instead of a round trip — but the
	// decoded bytes are dropped on the floor rather than kept.
	if _, err := base64.StdEncoding.DecodeString(input.Audio.Data); err != nil {
		return errors.New("audio data is not valid base64")
	}

	return nil
}

// geminiUpstreamError is a refusal Google made, mapped to something the client can show.
type geminiUpstreamError struct {
	status  int
	message string
}

func (e geminiUpstreamError) Error() string { return e.message }

func callGemini(ctx context.Context, cfg GeminiConfig, input geminiProposeInput) (string, error) {
	parts := make([]geminiPart, 0, 2)
	if input.Audio != nil {
		parts = append(parts, geminiPart{InlineData: &geminiInlineData{
			MimeType: input.Audio.MimeType,
			Data:     input.Audio.Data,
		}})
	}
	if input.Text != "" {
		parts = append(parts, geminiPart{Text: input.Text})
	}

	body, err := json.Marshal(geminiRequest{
		SystemInstruction: &geminiContent{Parts: []geminiPart{{Text: input.System}}},
		Contents:          []geminiContent{{Role: "user", Parts: parts}},
		GenerationConfig: geminiGenerationConfig{
			Temperature:      0,
			ResponseMimeType: "application/json",
		},
	})
	if err != nil {
		return "", fmt.Errorf("encode gemini request: %w", err)
	}

	ctx, cancel := context.WithTimeout(ctx, cfg.timeout())
	defer cancel()

	url := fmt.Sprintf("%s/v1beta/models/%s:generateContent", cfg.endpoint(), cfg.model())
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("build gemini request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	// The header and not the query string: a URL with the key in it ends up in access logs,
	// in proxies, and in error messages.
	req.Header.Set("x-goog-api-key", cfg.APIKey)

	res, err := cfg.client().Do(req)
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return "", ctxErr
		}
		return "", fmt.Errorf("call gemini: %w", err)
	}
	defer res.Body.Close()

	// Bounded: an upstream that answers with a gigabyte must not become this server's memory
	// problem. A proposal is a few kilobytes of JSON.
	raw, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return "", fmt.Errorf("read gemini response: %w", err)
	}

	var parsed geminiResponse
	// A body that will not parse is only worth reporting when the status was already bad;
	// on 200 it is the failure itself.
	decodeErr := json.Unmarshal(raw, &parsed)

	if res.StatusCode != http.StatusOK {
		return "", geminiUpstreamError{
			status: mapGeminiStatus(res.StatusCode),
			// Google's own message, and nothing else from the body. It names the quota, the
			// bad key or the unknown model, and it does not echo the note back.
			message: upstreamMessage(res.StatusCode, parsed.Error.Message),
		}
	}
	if decodeErr != nil {
		return "", fmt.Errorf("decode gemini response: %w", decodeErr)
	}

	if reason := parsed.PromptFeedback.BlockReason; reason != "" {
		return "", geminiUpstreamError{
			status:  http.StatusUnprocessableEntity,
			message: "Gemini declined to answer for this note.",
		}
	}

	for _, candidate := range parsed.Candidates {
		var builder strings.Builder
		for _, part := range candidate.Content.Parts {
			builder.WriteString(part.Text)
		}
		if text := builder.String(); strings.TrimSpace(text) != "" {
			return text, nil
		}
	}

	// An empty answer is a real outcome and the client already has copy for it: the card
	// opens the vocabulary grid with nothing selected (§4.6).
	return "", geminiUpstreamError{
		status:  http.StatusUnprocessableEntity,
		message: "Gemini returned nothing for this note.",
	}
}

// mapGeminiStatus turns Google's status into ours. The distinction that matters to the client
// is "try again" versus "this will not work until the operator does something".
func mapGeminiStatus(upstream int) int {
	switch {
	case upstream == http.StatusTooManyRequests:
		return http.StatusTooManyRequests
	case upstream == http.StatusUnauthorized || upstream == http.StatusForbidden:
		// Not 401: the user's own session is fine. It is the server's key that is not.
		return http.StatusServiceUnavailable
	case upstream >= 500:
		return http.StatusBadGateway
	default:
		return http.StatusBadGateway
	}
}

func upstreamMessage(status int, message string) string {
	trimmed := strings.TrimSpace(message)
	if trimmed == "" {
		return fmt.Sprintf("Gemini refused the request (HTTP %d).", status)
	}
	// Bounded, because it is rendered.
	const limit = 300
	if utf8.RuneCountInString(trimmed) > limit {
		runes := []rune(trimmed)
		return string(runes[:limit]) + "…"
	}
	return trimmed
}
