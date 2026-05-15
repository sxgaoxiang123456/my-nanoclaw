# Tasks: AI 技术知识日报 Agent

**Input**: Design documents from `/specs/001-daily-news-digest/`
**Prerequisites**: plan.md, spec.md, data-model.md, contracts/fetch-script.md

**Tests**: TDD approach - test tasks are included per user story

**Organization**: Tasks grouped by user story to enable independent implementation and testing.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create project skeleton and configuration files

- [ ] T001 [P] Create `daily-digest/` directory structure and `data/.gitignore` in `groups/cli-with-muyu/daily-digest/`
  - **In**: none
  - **Out**: directory tree `daily-digest/{lib/,data/}` and `data/.gitignore` ignoring `*.json` and `*.log`

- [ ] T002 [P] Create `sources.json` with 5 initial data sources in `groups/cli-with-muyu/daily-digest/sources.json`
  - **In**: source definitions (HN, Anthropic, OpenAI, 量子位, 36氪)
  - **Out**: valid JSON config with `version`, `sources[]` array

- [ ] T003 [P] Update `container.json` to add `fast-xml-parser` npm dependency in `groups/cli-with-muyu/container.json`
  - **In**: existing container.json, package name `fast-xml-parser`
  - **Out**: updated container.json with `"packages": {"npm": ["fast-xml-parser"]}`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core types and fetcher modules that ALL user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T004 Create `types.ts` with shared type definitions in `groups/cli-with-muyu/daily-digest/types.ts`
  - **In**: entities from data-model.md (SourceConfig, RawItem, FetchResult, DailyDigest, Section, DigestItem)
  - **Out**: TypeScript type definitions exportable for all modules
  - **Test**: `bun typecheck` passes

- [ ] T005 [P] Create `lib/dedup.ts` with URL + title deduplication logic in `groups/cli-with-muyu/daily-digest/lib/dedup.ts`
  - **In**: `RawItem[]` array
  - **Out**: deduplicated `RawItem[]` array (normalized URL match OR exact title match)
  - **Test**: provide mock data with duplicate URLs and duplicate titles, verify output length

- [ ] T006 [P] Create `lib/hn-fetcher.ts` with batched concurrent HN API fetching in `groups/cli-with-muyu/daily-digest/lib/hn-fetcher.ts`
  - **In**: `limit: number` (default 30)
  - **Out**: `RawItem[]` array with `title`, `url`, `score`, `publishedAt`
  - **Test**: mock `fetch` responses for `topstories.json` and item endpoints; verify batch concurrency (5 per batch, 200ms interval)

- [ ] T007 [P] Create `lib/rss-fetcher.ts` with RSS/Atom parsing in `groups/cli-with-muyu/daily-digest/lib/rss-fetcher.ts`
  - **In**: `SourceConfig` object
  - **Out**: `RawItem[]` array with `title`, `url`, `description`, `publishedAt`
  - **Test**: provide mock RSS XML and mock Atom XML; verify parser handles both formats

**Checkpoint**: Foundation ready - types, dedup, HN fetcher, RSS fetcher all implemented and tested

---

## Phase 3: User Story 1 - 每日自动接收 AI 技术日报 (Priority: P1) 🎯 MVP

**Goal**: Complete automated daily digest generation and WeChat delivery pipeline

**Independent Test**: Run `bun run fetch.ts` and verify `data/raw.json` is generated with valid content

### Tests for User Story 1

- [ ] T008 [P] [US1] Write unit tests for `fetch.ts` orchestration in `groups/cli-with-muyu/daily-digest/fetch.test.ts`
  - **In**: mock `sources.json`, mocked `hn-fetcher.ts` and `rss-fetcher.ts`
  - **Out**: test file with cases for: all sources success, one source failure, all sources failure, dedup verification

### Implementation for User Story 1

- [ ] T009 [US1] Create `fetch.ts` main orchestration script in `groups/cli-with-muyu/daily-digest/fetch.ts`
  - **In**: `sources.json` config (read from disk)
  - **Out**: `data/raw.json` file (FetchResult format with `generatedAt`, `totalSources`, `totalItems`, `items`)
  - **Depends on**: T005, T006, T007

- [ ] T010 [P] [US1] Create `module-daily-digest.md` agent workflow instructions in `groups/cli-with-muyu/.claude-fragments/module-daily-digest.md`
  - **In**: spec.md workflow definition, structured output JSON schema, classification rules
  - **Out**: complete workflow fragment with: fetch step, read step, LLM prompt with structured output schema, send_message step, 2-hour dedup window rule

- [ ] T011 [P] [US1] Update `CLAUDE.md` to reference `module-daily-digest.md` in `groups/cli-with-muyu/CLAUDE.md`
  - **In**: existing CLAUDE.md, module-daily-digest.md path
  - **Out**: updated CLAUDE.md with `@./.claude-fragments/module-daily-digest.md` reference

**Checkpoint**: User Story 1 complete - running `bun run fetch.ts` produces valid `raw.json`; agent workflow instructions ready

---

## Phase 4: User Story 2 - 灵活配置信息源 (Priority: P2)

**Goal**: Enable dynamic source configuration via `sources.json` modifications

**Independent Test**: Modify `sources.json` (add/remove sources) and re-run `fetch.ts` to verify changes take effect

### Implementation for User Story 2

- [ ] T012 [US2] Verify `sources.json` hot-reload behavior by testing configuration changes
  - **In**: modified `sources.json` (e.g., add new RSS source, remove existing source, change fetchLimit)
  - **Out**: verified that `fetch.ts` respects new config without code changes
  - **Test**: before/after comparison of `raw.json` output

**Checkpoint**: User Story 2 complete - source configuration changes reflect immediately in next fetch

---

## Phase 5: User Story 3 - 查看任务状态和手动重试 (Priority: P3)

**Goal**: Allow users to query task status and manually trigger digest generation

**Independent Test**: Agent responds to "查看日报任务状态" and "立即生成日报" commands correctly

### Implementation for User Story 3

- [ ] T013 [US3] Add task status query and manual trigger instructions to `module-daily-digest.md`
  - **In**: existing module-daily-digest.md, scheduling MCP tools documentation (`list_tasks`, manual task execution)
  - **Out**: updated module-daily-digest.md with: status query workflow (`list_tasks`), manual trigger workflow, 2-hour dedup window enforcement

**Checkpoint**: User Story 3 complete - agent can handle status queries and manual triggers

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Error handling validation, integration tests, and documentation

- [ ] T014 [P] Validate error handling scenarios: single source failure, HN 429 rate limit, RSS parse failure
  - **In**: `sources.json` with invalid URLs, mock 429 responses, malformed RSS XML
  - **Out**: verified graceful degradation per spec edge cases (single source skip, exponential backoff, raw title fallback)

- [ ] T015 Run end-to-end validation per `quickstart.md` test scenarios
  - **In**: complete feature implementation
  - **Out**: all quickstart test scenarios passing (fetch script, digest generation, task scheduling)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup (T001-T003)
  - T004 MUST complete before T005-T007
  - T005, T006, T007 can run in parallel after T004
- **User Story 1 (Phase 3)**: Depends on Foundational (T005-T007)
  - T009 depends on T005-T007
  - T008 (tests) and T010, T011 can run in parallel with T009
- **User Story 2 (Phase 4)**: Depends on T009 (fetch.ts must exist)
- **User Story 3 (Phase 5)**: Depends on T010 (module-daily-digest.md must exist)
- **Polish (Phase 6)**: Depends on all user stories

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational. No dependencies on other stories.
- **User Story 2 (P2)**: Can start after US1 (T009). Independent otherwise.
- **User Story 3 (P3)**: Can start after US1 (T010). Independent otherwise.

### Parallel Opportunities

- T001, T002, T003 (Setup) - different files
- T005, T006, T007 (Foundational) - different files, same dependency (T004)
- T008 (tests), T010, T011 (US1 implementation) - different files
- T014, T015 (Polish) - different validation paths

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T003)
2. Complete Phase 2: Foundational (T004-T007)
3. Complete Phase 3: User Story 1 (T008-T011)
4. **STOP and VALIDATE**: Run `bun run fetch.ts`, verify `data/raw.json`
5. Test agent workflow with manual trigger

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. Add User Story 1 → Test fetch.ts + agent workflow → MVP complete
3. Add User Story 2 → Test config hot-reload
4. Add User Story 3 → Test status query + manual trigger
5. Run Polish validation → Feature complete

---

## Task Summary

| 指标 | 数值 |
|------|------|
| 总任务数 | 15 |
| Setup 任务 | 3 |
| Foundational 任务 | 4 |
| US1 任务 | 4 |
| US2 任务 | 1 |
| US3 任务 | 1 |
| Polish 任务 | 2 |
| 可并行任务 | 8 |
| 含测试的任务 | 6 |
