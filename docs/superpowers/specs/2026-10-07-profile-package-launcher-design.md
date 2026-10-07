# pi-profile 起動前ランチャーとプロファイル別パッケージ管理 — 設計案

関連Issue: https://github.com/Papillon6814/pi-profile/issues/2
対象リポジトリ: pi-profile、および既存pi-accountを管理するdotfiles。
状態: 本設計書と実装計画はユーザー承認済み。Nativeでworktree内の実装・依存準備・隔離検証を許可。commit/main統合/push/Issue変更/実環境反映/公開は別承認。

## 1. 目的と選択済み方針

pi-kuno / pi-muu / pi-rbxを入力すると、認証アカウントを維持したまま起動前に用途Profileを選び、共通リソースとそのProfileに割り当てたパッケージで通常のPiを起動する。最初の利用例はDevelopmentだけにpi-ghを割り当てること。

ユーザーが選択した方針:
- 標準Pi CLIを利用し、Pi本体の改修・SDKによるPi UIの再実装は行わない。
- Profileはプロセス単位で固定。/newは同じProfileを継続し、異なるProfileの会話へ移るときは再起動する。
- 新規の対話起動では選択画面を出す。保存会話は保存済みProfileを自動復元する。
- Pi標準のパッケージ取得・依存解決挙動を維持する。--offlineや独自の一律自動導入禁止は追加しない。
- 既存認証、モデル、thinking、MCP、プロジェクト信頼、安全ルールを維持する。

当初の文書作成許可は一時領域への設計書保存のみだった。その後、本設計書・計画とNativeでのworktree内実装・依存準備・隔離検証が承認された。commit/main統合/push/Issue変更/実環境反映/npm公開は引き続き別承認。

## 2. 構成

pi-profileパッケージにNode CLIのbin名 `pi-profile` を追加する。製品ソースはTypeScript、CLI配布物はビルド済みJavaScriptとする。node_modules内のTypeScriptをNodeへ直接実行させない。

CLIの操作:
- `pi-profile launch [--profile ID] -- [Pi引数...]`
- `pi-profile packages list --profile ID`
- `pi-profile packages add --profile ID SOURCE [--replace]`
- `pi-profile packages remove --profile ID SOURCE`
- `pi-profile packages install --profile ID`
- `pi-profile packages update --profile ID [SOURCE]`

add/removeは宣言の管理、install/updateはPi標準PackageManagerを使った明示的な取得・更新とする。removeは割当解除のみで、実体キャッシュを自動削除しない。キャッシュの削除コマンドは初期版に含めない。

起動フロー:

```text
pi-muu / pi-kuno / pi-rbx
  -> 既存pi-accountで認証用agentDirを決定
  -> pi-profile launch -- 元のPi引数
  -> 新規ならProfile選択、再開なら保存Profileを復元
  -> 宣言した専用パッケージをPi標準PackageManagerで解決
  -> 起動情報をプロセス専用に用意
  -> 元のagentDirと引数を維持して通常Piを起動
```

既存pi-accountの補修・認証分離・共有リンク処理は今回勝手に整理しない。変更は通常Piを呼ぶ箇所から新ランチャーへ接続する部分と、明示的な旧経路復帰に限定する。実行中の認証用PI_CODING_AGENT_DIRをProfile名で変更しない。

素の `pi` は従来の起動経路・Pi内の選択挙動を維持する。ランチャー経由の会話だけ起動前選択と固定Profileを使用する。

## 3. Profile宣言とパッケージの保存

個人Profile保存先は既存のPI_PROFILE_DIR、未指定時は ~/.pi/agent/profiles を維持する。Developmentの内部IDはdeveloper。フォルダ名とIDを混同しない。

各Profileの `packages.json`:

```json
{
  "version": 1,
  "packages": [
    "npm:pi-gh@0.1.0"
  ]
}
```

上記は書式例であり、未公開のpi-ghを実際に取得したり、個人Profileに自動配置したりしない。

- ファイル省略は空の宣言。
- 初期版はnpm/Git/ローカルのsource文字列を扱う。パッケージ個別resource filterのUIは含めない。
- sourceの形式、npm/Git取得・依存解決・更新は標準PackageManagerへ委譲する。
- 正確なnpm版やGit refを宣言可能にするが、標準Piが許容する未固定sourceを独自に禁止しない。未固定の意味を表示する。
- ローカルの相対パスは宣言ファイルのフォルダを基準に正規化する。宣言ファイルのProfileルート逸脱、未知キー、重複キー、不正な構造は拒否する。
- addで同identityが既存なら、黙ってversionを置き換えず--replaceを必要とする。
- version/依存の完全な不変性やOSサンドボックスを保証する機能ではない。

専用パッケージ実体の管理領域は ~/.pi/profile-packages/ とし、Profile IDごとに標準PackageManagerのnpm/git保存領域を分ける。これは認証用agentDirではなく、パッケージ保存だけの管理ルート。通常PiのPI_CODING_AGENT_DIRや共通settingsを切り替えるために使わない。

PackageManagerへ与える宣言はメモリ上の設定とし、個人Profile宣言を共通settings.jsonへ複製しない。npmCommand等の取得に必要な通常設定は引き継ぐが、auth.jsonをコピーしない。共有設定がsymlinkでもリンク置換や書き換えを行わない。

## 4. 標準の自動取得を維持する境界

起動時に選択ProfileのPackageManager.resolveを標準の動作で呼ぶ。未導入や標準のversion条件を満たさない場合の取得を許容する。共通パッケージの解決・モデル一覧更新などは、通常Piに従来どおり任せる。

専用パッケージから解決したextensions/skills/prompts/themesを通常Piの明示resource引数へ渡す。取得処理を独自実装せず、Pi標準のmanifest解釈・依存処理を再利用する。

reloadでは専用パッケージの標準解決も再実施する。Profile IDと起動時に決めたsource集合はプロセス中に変えない。packages.jsonの割当変更やresource入口の集合変更は再起動で反映する。取得・読み込みの失敗はPi標準の扱いを維持する。初回起動エラーは通常CLIが停止するが、reload失敗後の強制停止は保証せず、問題時は新プロセスで再起動する。

Pi標準の挙動を維持することと、モデルが好きなsourceを無断追加できることは別。新たな割当・手動更新は明示操作であり、拡張の実行は通常のOS権限で行われる。

## 5. 起動前選択と既存拡張の連携

起動前の選択UIは小さな独立した端末画面とし、Profile一覧、説明、割当パッケージを確認できる。上下移動・Enter・Esc・Ctrl-Cを扱い、日本語・狭い端末・resizeに対応する。Piが始まる前に端末状態を戻す。Piの画面内に第二の端末rendererを作らない。

新規対話起動のEscはOther、Ctrl-Cは起動中止。stdin/stdoutが対話端末でない場合は選択を待たず、新規はOtherを既定にする。明示--profileは有効なIDだけを受け付ける。

ランチャーは選択ID・指示snapshot・source集合・対象会話識別情報を含む起動情報を、所有するプロセス専用ファイルで既存startup-profile拡張へ渡す。ファイルはprivate permissionで作り、所有範囲だけを後片付けする。source/pathをログやモデルpromptへ不用意に出さない。

拡張は起動情報の形式・会話との整合性を確認し、ランチャー経由ではPi内のProfile選択を出さない。現行version:1の指示snapshot形式を維持する。ランチャー管理情報は別のcustom entryとして記録し、指示本文の固定性を壊さない。

会話ファイルに保存されたsource/pathはコード実行許可ではない。現在のローカル宣言との照合を経て解決し、会話記録だけを根拠に任意のパッケージを取得しない。保存会話のProfileを復元した際、専用パッケージはそのProfileの現在の宣言から解決する。

## 6. 会話ライフサイクル

- 新規: 起動前選択でProfileを確定し、選択後に専用パッケージを解決する。
- --continue / --session / 既存--session-id: 対象会話の保存Profileを読み取り専用で判定して復元。snapshotなしはOther。不正・矛盾したsnapshotは診断して起動を拒否する。
- --resume: 起動前に会話を選び、そのProfileで起動。通常Piへ選択済み会話を明示して二重の選択画面を避ける。
- 新しい--session-id: 新規会話の選択規則を使う。
- --fork: fork元の保存Profileを復元し、通常Piのfork挙動を維持する。
- --no-session: 固定Profileはプロセス内だけ。終了後に復元できない。
- /new: 起動時のProfileとsource集合を継続。Profile選択画面を再表示しない。
- /resume / session switch: 対象の保存Profileが現在と違えば切替前に拒否し、新プロセスでの再開方法を表示。同Profileなら通常Piに任せる。
- reload: Profileを変えず標準解決・再ロード。保存済み指示本文は従来どおり維持。
- fork/clone/tree: 固定Profileを維持し、snapshotがない枝への移動時も元の指示継承規則を維持する。
- print/JSON/RPC: stdoutの本文/protocolを壊さない。診断はstderr。再開は保存Profile、新規はOtherまたは明示--profile。
- 子agent: 新しい選択画面を出さない。親の全パッケージを無条件に子へ加えない。pi-subagentsの既存extensions/ambient/tool allowlistの意味を維持し、必要な連携を隔離テストで確認する。

起動引数はshell文字列へ再構成せずargv配列で渡す。Piの引数を勝手に削除・並べ替えせず、会話を事前選択した場合のみ同じ対象を明示する形へ正規化する。`--`、空白、日本語、@file、初期prompt、piped stdinを保全する。

## 7. 重複・信頼・依存

専用宣言に共通で有効な同identityのパッケージがあれば、専用として追加したふりをせず診断する。初期版は曖昧な共通/専用重複を拒否し、ユーザーが割当を整理する。npm名、正規化Git repo、ローカル実パスを区別する。別取得経路による同名ツール衝突も診断対象。

プロジェクトパッケージ・.pi内のresourceは、通常Piのproject trustを維持する。launcherがそれらを無条件の個人CLI resourceへ変換して信頼確認を迂回しない。起動前のProfile解決は個人Profileの明示した宣言だけを対象にする。

Piが提供するAPIはpeer dependencyとして扱い、別Piをdependenciesへ同梱しない。CLIは実際に起動するPiのnpmインストール実体を検出し、その公開entrypoint/APIを使う。認証やモデルruntimeはCLIのProfile判定のために新規作成しない。初期対応はnpm配置のPi 1.0.4、Node 26.10.0以上、macOS/Linux。非対応配置は推測したSDKをimportせず診断する。従来の拡張単体のPi 1.0.2互換は維持し、新CLIの対応範囲を別記する。

## 8. 失敗・復旧

- Profile宣言不正はsourceを読み込む前に拒否。欠落した個人Profile rootは既存のOther規則を維持。
- 削除/無効化Profileの保存会話は指示snapshotを保全。専用宣言を勝手に復活させず、復旧または明示的な専用機能なし再開の方法を示す。
- パッケージ取得失敗・起動情報不整合は診断して拒否する。拡張ロードエラーはPi標準に任せ、初回は停止、reload後の強制停止は保証しない。構成の宣言とロード成功を混同する表示はしない。RPC reloadでfactoryエラーの通知がない場合もあるため、問題時の再起動を明記する。
- 別Profileへの移動は自動的に旧会話を閉じず、再起動を案内する。
- SIGINT/SIGTERM、選択中止、子Piの終了で端末と所有する起動情報を片付ける。稼働中の別会話・別Profileのキャッシュを削除しない。
- `PI_PROFILE_LAUNCHER=0 pi-muu` のような明示的な旧起動経路を用意する。ランチャー欠落時に黙って旧経路へfallbackしない。旧経路は今回の管理機能を使用しないため、専用機能の同等動作を保証しない。
- 管理コマンドの宣言変更は対象ファイルだけ、競合検知とatomic writeを使う。既存Profile本文や他の割当は変更しない。

## 9. 実装・反映境界

pi-profile側: CLI、Profile package宣言/標準resolver、起動前session判定、startup-profileとの連携、ライフサイクルguard、tests/docs、ビルド・bin登録。

dotfiles側: pi-accountの通常Pi呼出しをpi-profile launchへ接続し、明示bypassを追加。pi-kuno/muu/rbxの入口名は維持。実ファイルへのchezmoi反映・CLIのPATH登録は別承認の導入段階で行う。

コードは各repoの今回専用feature worktreeで実装する。既存worktreeは流用しない。コードのcommit/main統合/push、実環境へのインストール/反映、公開は別途対象と影響を確認する。pi-ghの作成・移管・npm公開は後続の別成果単位。

## 10. 受け入れ条件

- pi-kuno/muu/rbxの新規起動で選択画面が1回だけ現れ、選択後に通常Piが開く。
- Development専用の合成パッケージのimport/factory/tool/command/eventは、他Profileの新規プロセスでは実行・登録されない。
- npm/Git/ローカルsourceが標準resolverで扱われ、偽npm/Gitによる取得試験と固定/未固定sourceの挙動を確認する。--offlineや同等の一律抑制を追加しない。
- モデル一覧の自動更新の設定・経路を維持し、loopbackモデルで通常promptが動く。
- source追加/置換/解除、明示install/update、取得失敗、同identity重複、名前衝突、依存不足を検証する。
- 新規/continue/session/session-id/resume/fork/no-session、/new/reload/tree/clone、非対話mode、子agentの期待挙動を検証する。
- 異なるProfileへのsession switchを旧runtime破棄前に拒否し、会話を保全する。
- 3つの合成認証環境でauth/MCP/modelが混ざらない。共通settings/Profile本文を変更しない。
- プロジェクトのtrust拒否/承認を維持し、未信頼resourceをlauncherが先読みして実行しない。
- 日本語、狭い端末、resize、Esc/Ctrl-C、引数中の空白/--/@file/prompt/piped stdinとJSON/RPC stdoutを検証する。
- SIGINT/SIGTERM/取得失敗/子Pi終了で端末・所有一時状態を解放し、他会話を止めない。
- 既存のunit/type/Python/実CLI検証を維持する。合成HOME/認証・fake npm/Git・loopbackモデルを使い、実アカウントや外部モデルへの検証送信を行わない。

## 11. 調査証拠と残るレビュー

同じ一時ディレクトリのREPORT.md、run-3.tap（15/15 pass）、profile-existing-resolved.tap（35/35 pass）を参照する。これらは現行APIの調査証拠であり、新ランチャー製品の合格証明ではない。

本設計書レビュー後に、ファイル分割・具体的なpublic API接続・標準resolverからCLI resourceへのmetadata維持・reload失敗処理・配布bin導入手順を実装計画へ落とす。CLI本体/UI再実装やPi内部へのmonkey patchで制約を迂回しない。公開APIだけで受け入れ条件を満たせないことが判明したら実装を止め、仕様変更の判断を求める。
