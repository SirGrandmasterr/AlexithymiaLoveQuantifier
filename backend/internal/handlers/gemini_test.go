package handlers

// What these tests hold is the three promises in gemini.go's header, and one more that only
// a test can hold: **the key is sent in a header and never anywhere else.** A key that leaks
// into a query string is invisible in code review and obvious in an access log.

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

const testGeminiKey = "AIza-test-key-not-a-real-one"

// A minimal RIFF header plus a little silence. Never decoded by the handler, but it is what
// the client actually sends, so the tests send it too.
func wavBase64(samples int) string {
	body := make([]byte, 44+samples*2)
	copy(body[0:], "RIFF")
	copy(body[8:], "WAVEfmt ")
	copy(body[36:], "data")
	return base64.StdEncoding.EncodeToString(body)
}

func geminiRoutes(r *gin.Engine) {
	r.GET("/journal/propose/status", GeminiStatus)
	r.POST("/journal/propose", ProposeWithGemini)
}

// upstream stands in for Google. It records what it was asked and answers what it was told.
type upstream struct {
	server   *httptest.Server
	requests []*http.Request
	bodies   []string
	status   int
	body     string
	delay    time.Duration
}

func newUpstream(t *testing.T, status int, body string) *upstream {
	t.Helper()
	up := &upstream{status: status, body: body}
	up.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		up.requests = append(up.requests, r)
		up.bodies = append(up.bodies, string(raw))
		if up.delay > 0 {
			time.Sleep(up.delay)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(up.status)
		fmt.Fprint(w, up.body)
	}))
	t.Cleanup(up.server.Close)
	return up
}

// withGemini points the process-wide config at a fake upstream for one test.
func withGemini(t *testing.T, cfg GeminiConfig) {
	t.Helper()
	previous := geminiConfig
	SetGeminiConfig(cfg)
	t.Cleanup(func() { SetGeminiConfig(previous) })
}

func answer(text string) string {
	payload := map[string]any{
		"candidates": []any{map[string]any{
			"content": map[string]any{"parts": []any{map[string]any{"text": text}}},
		}},
	}
	encoded, _ := json.Marshal(payload)
	return string(encoded)
}

func proposeBody(t *testing.T, body string) *httptest.ResponseRecorder {
	t.Helper()
	return call(t, http.MethodPost, "/journal/propose", 1, body, geminiRoutes)
}

func audioRequest(t *testing.T) string {
	t.Helper()
	encoded, err := json.Marshal(map[string]any{
		"system": "You label a spoken note.",
		"text":   "Listen to the note and answer with the JSON object.",
		"audio":  map[string]any{"mime_type": "audio/wav", "data": wavBase64(1600)},
	})
	if err != nil {
		t.Fatalf("Failed to build request: %v", err)
	}
	return string(encoded)
}

/* Status: what the settings screen asks before it offers the toggle */

func TestGeminiStatusReportsUnavailableWithoutKey(t *testing.T) {
	withGemini(t, GeminiConfig{})

	w := call(t, http.MethodGet, "/journal/propose/status", 1, "", geminiRoutes)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 but got %d", w.Code)
	}

	var body struct {
		Available bool   `json:"available"`
		Model     string `json:"model"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}
	if body.Available {
		t.Error("Expected available=false with no API key")
	}
	if body.Model != geminiDefaultModel {
		t.Errorf("Expected the default model to be named, got %q", body.Model)
	}
}

func TestGeminiStatusNeverRevealsTheKey(t *testing.T) {
	withGemini(t, GeminiConfig{APIKey: testGeminiKey, Model: "gemini-2.5-flash"})

	w := call(t, http.MethodGet, "/journal/propose/status", 1, "", geminiRoutes)
	if strings.Contains(w.Body.String(), testGeminiKey) {
		t.Fatalf("The status endpoint echoed the API key: %s", w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"available":true`) {
		t.Errorf("Expected available=true with a key set, got %s", w.Body.String())
	}
}

/* The relay itself */

func TestProposeForwardsAudioAndReturnsTheModelText(t *testing.T) {
	up := newUpstream(t, http.StatusOK, answer(`{"transcript":"a nice day","feelings":[]}`))
	withGemini(t, GeminiConfig{APIKey: testGeminiKey, Endpoint: up.server.URL, Model: "gemini-2.5-flash"})

	w := proposeBody(t, audioRequest(t))
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 but got %d (body: %s)", w.Code, w.Body.String())
	}

	var body struct {
		Text  string `json:"text"`
		Model string `json:"model"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("Failed to parse response: %v", err)
	}
	if !strings.Contains(body.Text, "a nice day") {
		t.Errorf("Expected the model's text to come back verbatim, got %q", body.Text)
	}
	if body.Model != "gemini-2.5-flash" {
		t.Errorf("Expected the model that answered to be named, got %q", body.Model)
	}

	if len(up.bodies) != 1 {
		t.Fatalf("Expected exactly one upstream call, got %d", len(up.bodies))
	}

	// The audio travelled as inline data, which is the whole point: no transcription step.
	var sent geminiRequest
	if err := json.Unmarshal([]byte(up.bodies[0]), &sent); err != nil {
		t.Fatalf("Failed to parse the upstream request: %v", err)
	}
	if len(sent.Contents) != 1 {
		t.Fatalf("Expected one user turn, got %d", len(sent.Contents))
	}
	var inline *geminiInlineData
	for _, part := range sent.Contents[0].Parts {
		if part.InlineData != nil {
			inline = part.InlineData
		}
	}
	if inline == nil {
		t.Fatal("Expected the audio to be forwarded as inline data")
	}
	if inline.MimeType != "audio/wav" {
		t.Errorf("Expected audio/wav upstream, got %q", inline.MimeType)
	}
	if inline.Data == "" {
		t.Error("Expected the recording's bytes to be forwarded")
	}
	if sent.GenerationConfig.ResponseMimeType != "application/json" {
		t.Errorf("Expected JSON mode, got %q", sent.GenerationConfig.ResponseMimeType)
	}
	if sent.GenerationConfig.Temperature != 0 {
		t.Errorf("Expected temperature 0 so a note proposes the same thing twice, got %v", sent.GenerationConfig.Temperature)
	}
	if sent.SystemInstruction == nil || len(sent.SystemInstruction.Parts) == 0 {
		t.Fatal("Expected the client's system prompt to be forwarded")
	}
	if sent.SystemInstruction.Parts[0].Text != "You label a spoken note." {
		t.Errorf("Expected the prompt verbatim, got %q", sent.SystemInstruction.Parts[0].Text)
	}
}

func TestProposeSendsTheKeyAsAHeaderAndNotInTheURL(t *testing.T) {
	up := newUpstream(t, http.StatusOK, answer(`{"feelings":[]}`))
	withGemini(t, GeminiConfig{APIKey: testGeminiKey, Endpoint: up.server.URL})

	if w := proposeBody(t, audioRequest(t)); w.Code != http.StatusOK {
		t.Fatalf("Expected 200 but got %d (body: %s)", w.Code, w.Body.String())
	}

	req := up.requests[0]
	if got := req.Header.Get("x-goog-api-key"); got != testGeminiKey {
		t.Errorf("Expected the key in x-goog-api-key, got %q", got)
	}
	if strings.Contains(req.URL.String(), testGeminiKey) {
		t.Errorf("The API key ended up in the URL: %s", req.URL.String())
	}
	if strings.Contains(up.bodies[0], testGeminiKey) {
		t.Error("The API key ended up in the request body")
	}
}

func TestProposeAcceptsATypedNoteWithNoAudio(t *testing.T) {
	up := newUpstream(t, http.StatusOK, answer(`{"feelings":[]}`))
	withGemini(t, GeminiConfig{APIKey: testGeminiKey, Endpoint: up.server.URL})

	w := proposeBody(t, `{"system":"You label a note.","text":"The note is: work was hard."}`)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 but got %d (body: %s)", w.Code, w.Body.String())
	}

	var sent geminiRequest
	if err := json.Unmarshal([]byte(up.bodies[0]), &sent); err != nil {
		t.Fatalf("Failed to parse the upstream request: %v", err)
	}
	for _, part := range sent.Contents[0].Parts {
		if part.InlineData != nil {
			t.Error("Expected no audio part for a typed note")
		}
	}
}

/* Refusals */

func TestProposeIsUnavailableWithoutAKey(t *testing.T) {
	withGemini(t, GeminiConfig{})

	w := proposeBody(t, audioRequest(t))
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("Expected 503 with no key configured, got %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), "GEMINI_API_KEY") {
		t.Errorf("Expected the answer to name what the operator must set, got %s", w.Body.String())
	}
}

func TestProposeRequiresAuthentication(t *testing.T) {
	withGemini(t, GeminiConfig{APIKey: testGeminiKey})

	// userID 0 means the middleware set nothing, which is what an unauthenticated request
	// looks like to a handler.
	w := call(t, http.MethodPost, "/journal/propose", 0, audioRequest(t), geminiRoutes)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("Expected 401 without a session, got %d", w.Code)
	}
}

func TestProposeRejectsAnUnsupportedAudioType(t *testing.T) {
	up := newUpstream(t, http.StatusOK, answer(`{}`))
	withGemini(t, GeminiConfig{APIKey: testGeminiKey, Endpoint: up.server.URL})

	body := fmt.Sprintf(`{"system":"s","audio":{"mime_type":"application/zip","data":%q}}`, wavBase64(8))
	w := proposeBody(t, body)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("Expected 400 for an unsupported type, got %d", w.Code)
	}
	if len(up.bodies) != 0 {
		t.Error("Expected nothing to be forwarded upstream")
	}
}

func TestProposeAcceptsAParameterisedAudioType(t *testing.T) {
	up := newUpstream(t, http.StatusOK, answer(`{"feelings":[]}`))
	withGemini(t, GeminiConfig{APIKey: testGeminiKey, Endpoint: up.server.URL})

	body := fmt.Sprintf(`{"system":"s","audio":{"mime_type":"audio/wav; codecs=1","data":%q}}`, wavBase64(8))
	if w := proposeBody(t, body); w.Code != http.StatusOK {
		t.Fatalf("Expected 200 for a parameterised type, got %d (body: %s)", w.Code, w.Body.String())
	}

	var sent geminiRequest
	if err := json.Unmarshal([]byte(up.bodies[0]), &sent); err != nil {
		t.Fatalf("Failed to parse the upstream request: %v", err)
	}
	if sent.Contents[0].Parts[0].InlineData.MimeType != "audio/wav" {
		t.Errorf("Expected the parameter to be stripped, got %q", sent.Contents[0].Parts[0].InlineData.MimeType)
	}
}

func TestProposeRejectsAudioThatIsNotBase64(t *testing.T) {
	up := newUpstream(t, http.StatusOK, answer(`{}`))
	withGemini(t, GeminiConfig{APIKey: testGeminiKey, Endpoint: up.server.URL})

	w := proposeBody(t, `{"system":"s","audio":{"mime_type":"audio/wav","data":"not base64 !!"}}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("Expected 400 for invalid base64, got %d", w.Code)
	}
	if len(up.bodies) != 0 {
		t.Error("Expected nothing to be forwarded upstream")
	}
}

func TestProposeRejectsANoteWithNeitherAudioNorText(t *testing.T) {
	withGemini(t, GeminiConfig{APIKey: testGeminiKey})

	if w := proposeBody(t, `{"system":"s"}`); w.Code != http.StatusBadRequest {
		t.Fatalf("Expected 400 for an empty note, got %d", w.Code)
	}
}

func TestProposeRejectsAMissingPrompt(t *testing.T) {
	withGemini(t, GeminiConfig{APIKey: testGeminiKey})

	if w := proposeBody(t, `{"text":"work was hard"}`); w.Code != http.StatusBadRequest {
		t.Fatalf("Expected 400 with no system prompt, got %d", w.Code)
	}
}

func TestProposeRejectsAnOversizedRecording(t *testing.T) {
	withGemini(t, GeminiConfig{APIKey: testGeminiKey})

	oversized := strings.Repeat("A", maxGeminiAudioBase64+4)
	body := fmt.Sprintf(`{"system":"s","audio":{"mime_type":"audio/wav","data":%q}}`, oversized)
	w := proposeBody(t, body)
	// Either gate is correct — the body reader or the field check — and both refuse.
	if w.Code != http.StatusRequestEntityTooLarge && w.Code != http.StatusBadRequest {
		t.Fatalf("Expected the oversized recording to be refused, got %d", w.Code)
	}
}

/* What upstream failures look like from here */

func TestProposeMapsABadKeyToUnavailableRatherThanSigningTheUserOut(t *testing.T) {
	up := newUpstream(t, http.StatusForbidden, `{"error":{"code":403,"message":"API key not valid."}}`)
	withGemini(t, GeminiConfig{APIKey: testGeminiKey, Endpoint: up.server.URL})

	w := proposeBody(t, audioRequest(t))
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("Expected 503 for a rejected key, got %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), "API key not valid") {
		t.Errorf("Expected Google's own message, got %s", w.Body.String())
	}
}

func TestProposePassesQuotaExhaustionThrough(t *testing.T) {
	up := newUpstream(t, http.StatusTooManyRequests, `{"error":{"code":429,"message":"Quota exceeded."}}`)
	withGemini(t, GeminiConfig{APIKey: testGeminiKey, Endpoint: up.server.URL})

	if w := proposeBody(t, audioRequest(t)); w.Code != http.StatusTooManyRequests {
		t.Fatalf("Expected 429 to survive the hop, got %d", w.Code)
	}
}

func TestProposeMapsAnUpstreamOutageToBadGateway(t *testing.T) {
	up := newUpstream(t, http.StatusInternalServerError, `{"error":{"code":500,"message":"Internal."}}`)
	withGemini(t, GeminiConfig{APIKey: testGeminiKey, Endpoint: up.server.URL})

	if w := proposeBody(t, audioRequest(t)); w.Code != http.StatusBadGateway {
		t.Fatalf("Expected 502 for an upstream failure, got %d", w.Code)
	}
}

func TestProposeReportsAnEmptyAnswerRatherThanAnEmptyProposal(t *testing.T) {
	up := newUpstream(t, http.StatusOK, `{"candidates":[]}`)
	withGemini(t, GeminiConfig{APIKey: testGeminiKey, Endpoint: up.server.URL})

	if w := proposeBody(t, audioRequest(t)); w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("Expected 422 when the model said nothing, got %d", w.Code)
	}
}

func TestProposeReportsABlockedPrompt(t *testing.T) {
	up := newUpstream(t, http.StatusOK, `{"promptFeedback":{"blockReason":"SAFETY"}}`)
	withGemini(t, GeminiConfig{APIKey: testGeminiKey, Endpoint: up.server.URL})

	w := proposeBody(t, audioRequest(t))
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("Expected 422 for a blocked note, got %d", w.Code)
	}
	// The note is the user's own speech. Naming it back at them, or quoting Google's
	// category, would be the app judging what they said — which §5.4 forbids everywhere else.
	if strings.Contains(w.Body.String(), "SAFETY") {
		t.Errorf("Expected no verdict on the note, got %s", w.Body.String())
	}
}

func TestProposeTimesOutRatherThanHangingOnTheUpstream(t *testing.T) {
	up := newUpstream(t, http.StatusOK, answer(`{}`))
	up.delay = 150 * time.Millisecond
	withGemini(t, GeminiConfig{
		APIKey:   testGeminiKey,
		Endpoint: up.server.URL,
		Timeout:  20 * time.Millisecond,
	})

	if w := proposeBody(t, audioRequest(t)); w.Code != http.StatusGatewayTimeout {
		t.Fatalf("Expected 504 when Gemini does not answer in time, got %d", w.Code)
	}
}

/* Configuration */

func TestLoadGeminiReadsTheEnvironment(t *testing.T) {
	previous := geminiConfig
	t.Cleanup(func() { SetGeminiConfig(previous) })

	t.Setenv("GEMINI_API_KEY", "  "+testGeminiKey+"  ")
	t.Setenv("GEMINI_MODEL", "gemini-2.5-pro")

	if !LoadGemini() {
		t.Fatal("Expected the relay to come up with a key set")
	}
	if got := GeminiSettings().APIKey; got != testGeminiKey {
		t.Errorf("Expected the key to be trimmed, got %q", got)
	}
	if got := GeminiSettings().EffectiveModel(); got != "gemini-2.5-pro" {
		t.Errorf("Expected the configured model, got %q", got)
	}
}

func TestLoadGeminiIsOffByDefault(t *testing.T) {
	previous := geminiConfig
	t.Cleanup(func() { SetGeminiConfig(previous) })

	t.Setenv("GEMINI_API_KEY", "")
	t.Setenv("GEMINI_MODEL", "")

	if LoadGemini() {
		t.Fatal("Expected the relay to stay off with no key — the default deployment runs on the device")
	}
	if got := GeminiSettings().EffectiveModel(); got != geminiDefaultModel {
		t.Errorf("Expected the default model to be named even when off, got %q", got)
	}
}
