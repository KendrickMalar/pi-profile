# Profile Folder Resources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Profileフォルダから、共通設定に加えて選択Profileの指示・スキル・専用名エージェントを利用できるようにする。

**Architecture:** Profile選択と保存済み指示の復元を既存のsession_startに残す。resources_discoverで選択IDに対応する安全なスキルパスを返し、同じ境界で専用エージェントを公開イベント登録する。登録解除は自分が所有するdisposeだけを使い、共有設定やpi-subagents本体は変更しない。

**Tech Stack:** TypeScript、Node組み込みnode:test、Pi公開API、Python unittest・PTY・loopback HTTPモデル。

**Spec:** `docs/superpowers/specs/2026-10-06-profile-folder-resources-design.md`

## Global Constraints

- 改修はpi-profileのみ。pi-subagents本体、実HOME、実認証、共有settings.json、MCP設定を変更しない。
- Piの対応下限は1.0.2、Nodeは26.10.0以上。Pi 1.0.2と1.0.4、pi-subagents 0.76.1を検証する。下限変更が必要なら停止して相談する。
- エージェント登録名は`profile.<Profile ID>.<name>`。共通側で`profile.`始まりの完全名を使わない運用とし、その規則に反する共通完全名衝突の自動回復は保証しない。
- 指示本文はversion:1スナップショットを保持。スキル・エージェントは再開/reload時に現在の定義を読む。
- スキルの同名は共通優先。子のskillPathがローカル優先になる点を考慮し、親と子で一致する候補を渡す。
- 共通・プロジェクトの安全指示を維持。入れ子の委任、外部runner、任意のProfile拡張コードは対象外。
- コード実装、依存インストール、コミット・公開、稼働環境への反映は今回の文書作成許可に含まれない。

## Review Focus

- 無効化した新形式IDが旧catalogの同IDで再び選択可能になる。
- reloadで削除したスキルや解除済みエージェントがキャッシュに残る。
- 同名スキルが親では共通、子ではProfile側として読み込まれる。
- Profile定義のsymlinkや深いスキル探索から外部ファイルが混入する。
- shutdown中の未完了選択・登録が別会話の所有状態に書き込まれる。

## File Structure

- Modify `extensions/startup-profile/catalog.ts`: 旧形式を保持したカタログ統合。
- Create `extensions/startup-profile/folder-profile.ts`: Profile探索、メタデータ、抑止ID、パス境界検証。
- Create `extensions/startup-profile/profile-resources.ts`: スキルの安全な候補とエージェントMarkdownの解析。
- Create `extensions/startup-profile/subagent-registration.ts`: 公開イベント契約、登録・解除。
- Modify `extensions/startup-profile/index.ts`: 会話・リソース寿命の接続。
- Keep `extensions/startup-profile/state.ts` and `prompt.ts` behavior; modify only if a regression test demonstrates a necessary change.
- Create Profileごとの`profile.json`と`instructions.md`。旧本文は初版では削除せず互換資料として保持。
- Create `tests/startup-profile/folder-profile.test.ts`, `profile-resources.test.ts`, `subagent-registration.test.ts`.
- Modify `tests/startup-profile/catalog.test.ts`, `extension.test.ts`, `tests/package.test.ts` and existing CLI harness/tests.
- Modify `README.md`, `docs/startup-profiles.md`; packageのfiles設定は現状のextensions配下を含むため原則維持。

## Execution Prerequisite

- [ ] 実装計画と実行方法の承認を受け、`using-git-worktrees`で本worktree・branch・既存差分を確認する。設計文書の未コミット差分を保護する。
- [ ] worktree内のみの依存セットアップについて許可を得る。許可後に`npm ci --ignore-scripts`を実行する。既存の他worktreeのnode_modulesを変更・リンク共有しない。
- [ ] `npm test`、`npm run typecheck`、`python3 -m unittest discover -s scripts/tests -v`のbaselineを取得する。失敗は先に報告し、勝手に回避しない。

## Task 1: フォルダ形式と旧形式の統合

**Files:** folder-profile.ts、catalog.ts、folder-profile.test.ts、catalog.test.ts。

**Interfaces:**
- `FolderProfile extends ProfileDefinition`: `directory: string; order: number; enabled: boolean`。
- `scanFolderProfiles(root: string): { profiles: FolderProfile[]; blockedIds: string[]; warnings: string[] }`。
- `loadProfiles(directory: string): { profiles: ProfileDefinition[]; warnings: string[] }`の既存呼び出し契約を維持。ProfileDefinitionに任意の`directory?: string`を追加する。
- blockedIdsは無効・重複・識別可能な不正IDを旧形式から復活させないために使う。不正JSONでIDを確定できなければ警告だけを出し、文字列推測で抑止しない。

- [ ] **RED:** `folder-profile.test.ts`に`loads_folder_defaults`、`sorts_order_then_id`、`disabled_id_blocks_legacy`、`duplicate_folder_ids_block_both`、`invalid_id_does_not_guess_legacy_id`、`rejects_escape_symlink`、`standard_has_no_instructions`を追加する。order既定100、enabled既定true、ID developerの維持をassertする。
- [ ] **Run:** `node --experimental-strip-types --test tests/startup-profile/folder-profile.test.ts`。新関数未実装によるFAILを記録する。
- [ ] **Implement:** rootのrealpathを境界に探索する。新形式の有効候補をorder/id順で並べ、blockedIdsを除いた旧catalog候補をcatalog順で追加する。新旧同IDは新形式優先・診断。standardを補完する。
- [ ] **GREEN:** 上記コマンドとcatalog.test.tsを実行し、旧形式のみの順序・既存Profile本文が変わらないことを確認する。
- [ ] **Checkpoint:** 差分確認。コミットは別途許可された場合だけ行う。

## Task 2: 安全なスキルとエージェント定義の解決

**Files:** profile-resources.ts、profile-resources.test.ts。

**Interfaces:**
- `CommonSkill = { name: string; filePath: string }`。
- `ProfileResources = { skillPaths: string[]; agents: ProfileAgent[]; warnings: string[] }`。
- `ProfileAgent = { name: string; definition: RuntimeAgentDefinitionSubset }`。Subsetは公開イベントのdescription/systemPrompt/tools/skills/model/thinking/systemPromptMode/inheritProjectContext/inheritGlobalContext/inheritSkills/skillPathのみ。
- `loadProfileResources(profile: ProfileDefinition, commonSkills: readonly CommonSkill[]): ProfileResources`。
- `commonSkillsFromCommands(commands: readonly SlashCommandInfo[]): { skills: CommonSkill[]; warnings: string[] }`。sourceがskillの項目から`skill:`を除き、sourceInfo.pathを参照する。読めない候補を推測したパスへ置換しない。

- [ ] **RED:** `profile-resources.test.ts`に`common_skill_wins_for_parent_and_child`、`preserves_empty_tools`、`rejects_unknown_agent_fields`、`rejects_duplicate_agent_names`、`rejects_nested_skill_symlink_escape`、`missing_optional_directories_are_empty`、`missing_selected_skill_is_diagnosed`を追加する。共通/ローカル同名SKILL.mdの内容を別のmarkerにし、子へ渡すパスが共通ファイルであることをassertする。
- [ ] **Run:** `node --experimental-strip-types --test tests/startup-profile/profile-resources.test.ts`。FAILを記録する。
- [ ] **Implement:** Piの公開`parseFrontmatter`・`loadSkillsFromDir`を使用し、独自YAMLパーサや全ファイルの無条件再帰を避ける。外部symlinkを検証してから読み込む。Profileスキルは共通との重複を除外し、親には採用したSKILL.mdの個別パスを返す。
- [ ] **Implement:** agents直下の.mdだけを解析する。必須name/description/本文と許可済み項目を検証。tools/skillsはカンマ形式と配列を正規化。未指定はappend・project/global継承true・skills継承false。canonical名を専用名にする。
- [ ] **Implement:** 子で明示選択するskillsについて、共通と採用済みProfileスキルから優先解決したSKILL.mdの個別絶対パスをskillPathへ渡す。directory全体を無条件に渡さない。欠落スキルのあるエージェントは診断して登録対象から除外する。
- [ ] **GREEN:** 対象suiteを実行。書き込みAPIを使わず、補助スクリプトを実行しないことも確認する。
- [ ] **Checkpoint:** 差分確認。新しい実行時依存は追加しない。

## Task 3: 専用エージェント登録と会話寿命

**Files:** subagent-registration.ts、index.ts、subagent-registration.test.ts、extension.test.ts。

**Interfaces:**
- `registerProfileAgents(pi: Pick<ExtensionAPI, 'events'>, agents: readonly ProfileAgent[]): { dispose(): void; names: string[]; warnings: string[] }`。
- eventは`pi-subagents:runtime-agent-register:v1`、requestは`{version:1,name,definition,result?}`。pi-subagentsをNode依存としてimportしない。
- 登録解除は返されたregistration.disposeだけを使う。関数自身のdisposeは冪等。

- [ ] **RED:** 登録suiteに`missing_owner_keeps_other_resources`、`malformed_owner_response_does_not_claim_success`、`partial_registration_keeps_valid_agents`、`dispose_is_idempotent`を追加し、イベントにresponseを返すfixture ownerで検証する。
- [ ] **Run:** `node --experimental-strip-types --test tests/startup-profile/subagent-registration.test.ts`。FAILを記録する。
- [ ] **Implement:** event契約を検証し、不在・失敗・不正responseを診断する。成功した登録だけを保持し、破棄時に全部解除する。
- [ ] **RED:** extension.test.tsに`resources_follow_restored_id`、`disabled_profile_keeps_snapshot_only`、`new_drops_previous_agents`、`reload_rereads_resources_not_instructions`、`shutdown_cancels_stale_registration`を追加する。旧harnessにevents/getCommandsと複数イベントhandlerを追加し、モデル・思考・active toolsの変更を引き続きassert.failにする。
- [ ] **Implement:** session_startで現在の定義を必ず読み、選択/保存IDと対応づける。resources_discoverではPiの共通スキル一覧を`pi.getCommands()`から取得し、resourcesを解決して登録する。前の所有登録を解除してから新規登録する。generation/sessionIdで古い処理の書き戻しを防ぐ。
- [ ] **Implement:** 実際に登録できた専用エージェントの名前・説明をbefore_agent_startの独立sectionとして提示する。指示snapshotには混ぜない。toolsの自動有効化や子の自動起動はしない。
- [ ] **GREEN:** 登録・extension・state・prompt suitesを実行。新規Other/Escでも有効なstandardフォルダの追加リソースだけを使い、不正snapshotは追加リソースなしにする。
- [ ] **Checkpoint:** 差分確認。共通の通常名reviewerと専用名が併存し、別名の自動生成がないことを確認する。

## Task 4: 初期Profileの移行と実CLI受け入れ

**Files:** profiles/*/profile.jsonとinstructions.md、scripts/test-startup-profile-cli.py、scripts/tests/、tests/package.test.ts。

**Interfaces:** CLIテストに`--subagents-extension PATH`を追加。対象pathは既存インストール済みのindex.jsを絶対パスで指定する。Profile resourceケースは`--case profile_resource_lifecycle`と`--case profile_subagent_resources`で単独実行できるようにする。

- [ ] **RED:** パッケージテストに5 Profileの存在とID research/specification/developer/chore/standard、順序10/20/30/40/50、元本文と移行本文のbytes同一をassertする。standardにinstructions.mdがないこと、packageのpi.skillsへ全Profileのskillsが登録されないこともassertする。
- [ ] **Implement:** 既存Profileを新フォルダへコピーし、旧catalogを削除せず空配列にする。旧Markdownは残す。旧形式の互換検証はfixture catalogで続ける。移行テストのRED→GREENを確認する。
- [ ] **RED:** CLI harnessに合成Profile A/B、共通marker skill、Profile marker skill、共通reviewerと専用エージェントを用意する。HOME/cwd/agentDir/XDGをfixtureへ限定し、実extensionsの自動探索を禁止し、許可済み拡張だけを明示ロードする。subagentsのNode/SDK解決失敗は製品失敗と分け、インストールや実HOME利用で回避しない。
- [ ] **Implement:** /skill:nameの実展開、A→Bの/new、保存Aのresume、Aでのreloadと削除、fork/clone、無効化をPTYで操作し、loopbackモデルの受信prompt・session entry・登録一覧をassertする。ローカルスキルのdisable-model-invocation:trueでも明示commandが動くケースを含める。
- [ ] **Implement:** 共通reviewerと専用名の両方を実起動し、専用名のskillsが子で共通優先になることを前景・背景の両方で確認する。同期登録fixtureだけでは成功としない。未選択Profileの定義が子へ混入しないことをassertする。
- [ ] **Implement:** pi-subagentsなし、壊れたProfile、外部symlink、Profile削除、意図的な共通完全名衝突の診断を負例にする。完全名衝突ケースの期待は診断と「非保証」の明示であり、共通側の自動復旧を要求しない。
- [ ] **GREEN:** 下記コマンドを実行し、case未選択による0件成功を許さない。受信promptに必要markerがない場合、テストが確実にFAILする負例も確認する。

```sh
npm test
npm run typecheck
python3 -m unittest discover -s scripts/tests -v
python3 scripts/test-startup-profile-cli.py --pi "$(command -v pi)"
python3 scripts/test-startup-profile-cli.py --pi "$(command -v pi)" \
  --subagents-extension /Users/papillon/.pi/agent/npm/node_modules/pi-subagents/index.js \
  --case profile_subagent_resources
```

- [ ] Pi 1.0.2では、その版のCLIパスを--piへ渡して同じresource lifecycle/childケースを実行する。既存の1.0.2 packageはextraction worktreeにあるが、そのworktreeを変更しない。1.0.2がない環境では未検証として止め、無断downloadしない。
- [ ] Plan互換の既存ケースも明示実行する。対象拡張は読み取りの既存パスだけを指定し、実Plan設定を変更しない。
- [ ] **Checkpoint:** fresh testsのexit code・実行件数・失敗/skip数・PTY/loopback evidenceを確認する。

## Task 5: 運用説明と全体の検証

**Files:** README.md、docs/startup-profiles.md、必要ならpackage.jsonのdescriptionのみ。

- [ ] **Write:** フォルダ追加・編集・enabled:false・skills/SKILL.md・agents/*.mdの最小例を説明。専用名の呼び方、共通側でprofile.始まりを使わない運用、既存会話の指示固定と追加機能更新の違い、pi-subagentsなしの挙動を明記する。
- [ ] **Write:** 子のtools指定がprovider拡張を自動ロードしないこと、許可された設定項目だけ使えること、子へ全Profileエージェントを継承しないことを説明する。スキル参照資料の完全固定やサンドボックスを保証しない。
- [ ] **Verify:** 全suiteを再実行し、`git diff --check`と変更ファイル一覧を確認する。秘密・実認証・共有設定・外部パッケージ変更がないことを確認する。
- [ ] **Review:** 実行方法で承認されたレビュー方式を使う。サブエージェント利用が未承認なら勝手に起動せず、必要なレビューの許可を得る。
- [ ] **Report:** 実出力と残る制限を提示する。稼働中のローカルパッケージへ反映するにはmainへの統合/共有登録元の切替が必要だが、今回のコード検証だけで実環境へ適用しない。

## Completion Boundary

実装worktreeでの検証成功と、現在のPiへの導入を分ける。コミット・main統合・push・PR・稼働設定変更は、それぞれ許可された範囲でだけ実施する。実装中に新しい制限が見つかり受け入れ条件を満たせない場合は、近道として共有設定の書き換えやpi-subagents内部APIの利用に切り替えず相談する。
