--
-- PostgreSQL database dump
--

\restrict SNotVgYOn5i7Syuphe5pJ5G6kDTMO83bTMIgn79aZWWxHXvE4ux1oMFfLU6MVmg

-- Dumped from database version 15.18
-- Dumped by pg_dump version 15.18

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: analysis_subjects; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.analysis_subjects (
    id bigint NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    deleted_at timestamp with time zone,
    user_id bigint,
    name text NOT NULL,
    description text,
    stats text,
    date timestamp with time zone,
    tags text,
    uncertain text,
    guide_answers text,
    relationship_id bigint
);


ALTER TABLE public.analysis_subjects OWNER TO postgres;

--
-- Name: analysis_subjects_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.analysis_subjects_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.analysis_subjects_id_seq OWNER TO postgres;

--
-- Name: analysis_subjects_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.analysis_subjects_id_seq OWNED BY public.analysis_subjects.id;


--
-- Name: relationships; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.relationships (
    id bigint NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    deleted_at timestamp with time zone,
    user_id bigint NOT NULL,
    name text NOT NULL
);


ALTER TABLE public.relationships OWNER TO postgres;

--
-- Name: relationships_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.relationships_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.relationships_id_seq OWNER TO postgres;

--
-- Name: relationships_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.relationships_id_seq OWNED BY public.relationships.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id bigint NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    deleted_at timestamp with time zone,
    email text NOT NULL,
    password text NOT NULL,
    name text,
    age bigint,
    mbti_type text,
    profile_picture text
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.users_id_seq OWNER TO postgres;

--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: analysis_subjects id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.analysis_subjects ALTER COLUMN id SET DEFAULT nextval('public.analysis_subjects_id_seq'::regclass);


--
-- Name: relationships id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.relationships ALTER COLUMN id SET DEFAULT nextval('public.relationships_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Data for Name: analysis_subjects; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.analysis_subjects (id, created_at, updated_at, deleted_at, user_id, name, description, stats, date, tags, uncertain, guide_answers, relationship_id) FROM stdin;
105	2026-03-02 13:03:03.0454+00	2026-03-02 13:03:03.0454+00	\N	1	Alex=> Nastja		{"agape":30,"eros":75,"ludus":10,"mania":0,"pragma":65,"selflessness":0,"storge":90}	2026-03-02 00:00:00+00	\N	\N	\N	1
1	2026-02-15 23:49:06.950246+00	2026-02-15 23:49:19.009109+00	2026-02-15 23:53:04.786017+00	1	Lea		\N	\N	\N	\N	\N	2
34	2026-02-15 23:53:19.80404+00	2026-02-15 23:53:19.80404+00	\N	1	Lea		{"agape":53,"eros":48,"ludus":32,"mania":70,"pragma":63,"selflessness":60,"storge":74}	\N	\N	\N	\N	2
38	2026-02-16 00:22:43.168384+00	2026-02-16 00:22:43.168384+00	\N	1	Lea		{"agape":23,"eros":35,"ludus":22,"mania":31,"pragma":48,"selflessness":51,"storge":76}	2026-02-16 00:00:00+00	\N	\N	\N	2
41	2026-02-16 00:23:31.494846+00	2026-02-16 00:23:31.494846+00	\N	1	Lea		{"agape":41,"eros":10,"ludus":43,"mania":58,"pragma":58,"selflessness":31,"storge":38}	2026-02-15 00:00:00+00	\N	\N	\N	2
42	2026-02-16 00:23:44.589414+00	2026-02-16 00:23:44.589414+00	\N	1	Lea		{"agape":60,"eros":11,"ludus":81,"mania":32,"pragma":96,"selflessness":13,"storge":3}	2026-02-11 00:00:00+00	\N	\N	\N	2
40	2026-02-16 00:23:18.724894+00	2026-02-16 00:23:18.724894+00	2026-07-26 00:08:20.002939+00	1	Lea		{"agape":14,"eros":68,"ludus":46,"mania":16,"pragma":26,"selflessness":32,"storge":40}	2026-02-18 00:00:00+00	\N	\N	\N	2
37	2026-02-16 00:20:12.096021+00	2026-02-16 00:20:12.096021+00	2026-07-26 00:08:22.85102+00	1	Lea		{"agape":39,"eros":52,"ludus":28,"mania":57,"pragma":24,"selflessness":72,"storge":15}	2026-02-17 00:00:00+00	\N	\N	\N	2
39	2026-02-16 00:22:52.867404+00	2026-02-16 00:22:52.867404+00	2026-07-26 00:08:24.653785+00	1	Lea		{"agape":23,"eros":35,"ludus":22,"mania":31,"pragma":48,"selflessness":51,"storge":76}	2026-02-17 00:00:00+00	\N	\N	\N	2
36	2026-02-16 00:19:57.427851+00	2026-02-16 00:19:57.427851+00	2026-07-26 00:08:26.093539+00	1	Lea		{"agape":33,"eros":30,"ludus":17,"mania":53,"pragma":18,"selflessness":66,"storge":11}	2026-02-16 00:00:00+00	\N	\N	\N	2
138	2026-07-26 00:09:13.961138+00	2026-07-26 00:09:34.15268+00	\N	1	Lea	We mainly dance. 	{"agape":23,"eros":35,"ludus":22,"mania":31,"pragma":48,"selflessness":51,"storge":76}	2026-07-26 00:00:00+00	["distance"]	[]	{}	2
71	2026-02-17 18:37:13.434722+00	2026-02-17 18:37:13.434722+00	\N	1	Mary		{"agape":58,"eros":63,"ludus":47,"mania":14,"pragma":45,"selflessness":47,"storge":16}	2026-02-17 00:00:00+00	\N	\N	\N	3
35	2026-02-15 23:53:39.13663+00	2026-02-15 23:53:39.13663+00	2026-02-15 23:54:26.831753+00	1	Sämäntha		{"agape":21,"eros":15,"ludus":14,"mania":10,"pragma":20,"selflessness":31,"storge":17}	\N	\N	\N	\N	4
104	2026-02-23 04:46:57.66653+00	2026-02-23 04:46:57.66653+00	\N	1	Vera		{"agape":63,"eros":7,"ludus":5,"mania":0,"pragma":70,"selflessness":0,"storge":87}	2026-02-23 00:00:00+00	\N	\N	\N	5
139	2026-07-26 02:37:32.527195+00	2026-07-26 02:37:32.527195+00	\N	1	Test		{"agape":0,"eros":0,"ludus":0,"mania":0,"pragma":0,"selflessness":0,"storge":0}	2026-07-26 00:00:00+00	[]	[]	{}	6
\.


--
-- Data for Name: relationships; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.relationships (id, created_at, updated_at, deleted_at, user_id, name) FROM stdin;
1	2026-07-26 02:27:57.679623+00	2026-07-26 02:27:57.679623+00	\N	1	Alex=> Nastja
2	2026-07-26 02:27:57.68396+00	2026-07-26 02:27:57.68396+00	\N	1	Lea
3	2026-07-26 02:27:57.686047+00	2026-07-26 02:27:57.686047+00	\N	1	Mary
4	2026-07-26 02:27:57.687318+00	2026-07-26 02:27:57.687318+00	\N	1	Sämäntha
5	2026-07-26 02:27:57.688526+00	2026-07-26 02:27:57.688526+00	\N	1	Vera
6	2026-07-26 02:37:32.526334+00	2026-07-26 02:37:32.526334+00	\N	1	Test
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.users (id, created_at, updated_at, deleted_at, email, password, name, age, mbti_type, profile_picture) FROM stdin;
1	2026-02-15 23:48:37.123114+00	2026-02-23 03:25:27.195265+00	\N	voglerphillip@gmx.de	$2a$14$dFd9ykiH5g2kLgnJWKsRm.C7EN5BuRVH7Dtqj/wh7ct1qAROKtfUa	Phillip Vogler	29	ISTP	
35	2026-07-26 00:58:42.076709+00	2026-07-26 00:58:42.076709+00	\N	phillipvogler@gmx.de	$2a$14$UVlU8KoN53t34iYCB.u4oOY7AGCMqqA.MDJLJMgqcJW8jo7ZwasEK		0		
36	2026-07-26 01:03:28.133361+00	2026-07-26 01:03:28.133361+00	\N	login@test.com	$2a$14$r4mbXVOSdadjskGBN0e4/.ta.HdzjbrRFHY9d1AhGgWKfR2sWCSEq		0		
\.


--
-- Name: analysis_subjects_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.analysis_subjects_id_seq', 139, true);


--
-- Name: relationships_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.relationships_id_seq', 6, true);


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.users_id_seq', 37, true);


--
-- Name: analysis_subjects analysis_subjects_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.analysis_subjects
    ADD CONSTRAINT analysis_subjects_pkey PRIMARY KEY (id);


--
-- Name: relationships relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.relationships
    ADD CONSTRAINT relationships_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: idx_analysis_subjects_deleted_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_analysis_subjects_deleted_at ON public.analysis_subjects USING btree (deleted_at);


--
-- Name: idx_analysis_subjects_relationship_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_analysis_subjects_relationship_id ON public.analysis_subjects USING btree (relationship_id);


--
-- Name: idx_relationships_deleted_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_relationships_deleted_at ON public.relationships USING btree (deleted_at);


--
-- Name: idx_relationships_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_relationships_user_id ON public.relationships USING btree (user_id);


--
-- Name: idx_users_deleted_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_deleted_at ON public.users USING btree (deleted_at);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_users_email ON public.users USING btree (email);


--
-- Name: analysis_subjects fk_analysis_subjects_relationship; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.analysis_subjects
    ADD CONSTRAINT fk_analysis_subjects_relationship FOREIGN KEY (relationship_id) REFERENCES public.relationships(id);


--
-- PostgreSQL database dump complete
--

\unrestrict SNotVgYOn5i7Syuphe5pJ5G6kDTMO83bTMIgn79aZWWxHXvE4ux1oMFfLU6MVmg

