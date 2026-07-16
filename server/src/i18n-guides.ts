// ─────────────────────────────────────────────────────────────────────────────
// Curated, human-quality translations of the highest-intent evergreen guides.
// Served at /{prefix}/guide/{slug} with a full bidirectional hreflang cluster.
// NOT machine-bulk-translated: only these vetted pages are localized, so we never
// ship thin auto-translated content across the whole site. Add a language by adding
// a LocaleCfg + the slug→tx entries; the seo.ts registration loop does the rest.
// Internal links intentionally point at the (English) live data pages — the data is
// language-neutral and cross-linking sends readers straight to the verifiable figures.
// ─────────────────────────────────────────────────────────────────────────────

export type GuideTx = {
  h1: string
  title: string
  description: string
  intro: string
  sections: { h: string; body: string }[]
  faqs: { q: string; a: string }[]
  related: string
}

export type LocaleCfg = {
  code: string // URL prefix segment, e.g. 'ja' → /ja/...
  hreflang: string // BCP-47 for <link hreflang> and <html lang>, e.g. 'pt-BR'
  label: string // human name (for logs / future language switcher)
  homeLabel: string // breadcrumb "Home"
  guidesLabel: string // breadcrumb "Guides"
  faqHeading: string // "FAQ" section heading
}

export const I18N_LOCALES: LocaleCfg[] = [
  { code: 'ja', hreflang: 'ja', label: '日本語', homeLabel: 'ホーム', guidesLabel: 'ガイド', faqHeading: 'よくある質問' },
  { code: 'ko', hreflang: 'ko', label: '한국어', homeLabel: '홈', guidesLabel: '가이드', faqHeading: '자주 묻는 질문' },
  { code: 'pt', hreflang: 'pt-BR', label: 'Português (BR)', homeLabel: 'Início', guidesLabel: 'Guias', faqHeading: 'Perguntas frequentes' },
]

// slug → locale.code → translation. Only slugs present here get localized variants.
export const GUIDE_I18N: Record<string, Record<string, GuideTx>> = {
  'are-crypto-casinos-safe': {
    ja: {
      h1: '仮想通貨カジノは安全か？',
      title: `仮想通貨カジノは安全？オンチェーンデータで見極める方法 | Tekel Data`,
      description: `仮想通貨カジノは安全なのか。資金を本当に危険にさらすものは何か、そして堅実な運営者とリスクの高い運営者を分けるオンチェーン・第三者シグナルを、実用的なチェックリストとともに解説します。`,
      intro: `「仮想通貨カジノは安全か」に単一の答えはありません。安全性は運営者ごとに異なり、推測ではなく<strong>測定</strong>できます。本ガイドでは、実際に資金を危険にさらす要因、ライセンスが守るもの・守らないもの、「プロバブリーフェア」と支払能力の違い、そして自分で検証できるシグナルに基づく入金前チェックリストを示します。`,
      sections: [
        { h: '本当のリスク（と、心配しすぎているリスク）', body: `<p>ほとんどの仮想通貨カジノは無ライセンス、または規制の緩い法域でのライセンスです。そのため資金を回収してくれる規制当局はまず存在しません。最大のリスクは不正なゲームではなく——プロバブリーフェアは一般的で数学的に検証可能です——<strong>運営者の支払能力と行動</strong>です。すなわちエグジット詐欺、静かな債務超過、あるいは凍結・制限・過剰な本人確認要求で出金が埋もれることです。プレイヤーはゲームの公正性を過度に心配し、運営者が実際に支払えるかを軽視しがちです。デューデリジェンスは後者に集中すべきです。</p>` },
        { h: 'ライセンスが意味すること・しないこと', body: `<p>キュラソーやアンジュアンのライセンスは取得が安価で、プレイヤーにとっての実質的な救済はほとんどありません。英国やマルタのライセンスが持つ消費者保護というより、事業登録に近いものです。ライセンスは無意味ではありません（一定のKYC/AMLと取消可能な許可を示唆します）が、<strong>弱いシグナル</strong>として扱い、保証とはみなさないでください。ライセンスのバッジを、運営者が資金を保有し支払っているかの確認の代わりにしてはいけません。この分野で最も強い保護は規制ではなく、<strong>透明性と検証可能なオンチェーンの挙動</strong>です。</p>` },
        { h: 'プロバブリーフェア ≠ 支払能力', body: `<p>プロバブリーフェアの暗号技術は、特定のベット結果が改ざんされていないことを検証できます。これは有用ですが、カジノがあなたの出金を賄えるかについては何も語りません。運営者は完全に公正なゲームを運営しながら、債務超過になったり支払いを拒否したりできます。公正性と支払能力は独立した軸です。暗号の仕組みは<a href="/guide/provably-fair-explained">プロバブリーフェア解説</a>を参照し、資金の問題とは切り離して考えてください。</p>` },
        { h: 'より安全な運営者のシグナル', body: `<p>直近の出金フローを余裕を持って賄える、検証可能な健全な<a href="/proof-of-reserves">オンチェーン準備金</a>。一貫した出金報告を伴う長い運営履歴。おおむね<em>一致</em>する複数の独立信頼評価（casino.guru、Trustpilot、AskGamblers）。入金と出金の双方が動くバランスの取れたオンチェーンフロー。そして直近の苦情急増がないこと。私たちは第三者評価を一つの独立した<a href="/rankings/trust">信頼スコア</a>にまとめ、手作業での比較を不要にしています。</p>` },
        { h: '危険信号（レッドフラグ）', body: `<p>検証できない、あるいは出金時期にだけ急増する準備金。運営者の評判とかけ離れたオンチェーン取引量（私たちが特集せず<em>審査中</em>として保留するウォッシュ/財務パターン）。出金苦情の突然の殺到。ほとんど対応する出金のない入金（プレイヤーが支払われていない可能性）。そして資金が事実上ロックされるほど高い賭け条件のボーナス。単一の兆候で断定はできません——リスクは<strong>複数の兆候の重なり</strong>に宿ります。古い苦情一件はノイズですが、準備金の減少＋一方向の流出＋苦情の波はパターンです。</p>` },
        { h: '入金前チェックリスト', body: `<p>口座に入金する前に：(1) 運営者に<a href="/crypto-casinos-with-proof-of-reserves">オンチェーン準備金</a>がマッピングされ安定しているか確認する。(2) 2つ以上の独立レビュー源がおおむね一致することを確認する。(3) 直近の苦情に<em>未解決の出金</em>というテーマがないか調べる。(4) ボーナス/賭け条件を承諾前に読む。(5) 本格的な資金を投じる前に、少額のテスト入金とテスト出金を行う。特別なことは何もありません——回避できた損失と回避できなかった損失を分ける、たった5分です。</p>` },
      ],
      faqs: [
        { q: '仮想通貨カジノは安全に使えますか？', a: '完全に運営者次第です。最大のリスクはゲームの公正性ではなく、支払能力と行動（エグジット詐欺、出金凍結）です。検証可能なオンチェーン準備金、長い実績、一貫した独立評価を持つ運営者を選び、必ず先に少額のテスト出金を行ってください。' },
        { q: '仮想通貨カジノが正当かどうか、どう確認できますか？', a: 'ブロックエクスプローラーでオンチェーン準備金を検証し、複数の独立レビュー源が一致するか確認し、直近の苦情に未解決の出金テーマがないか調べ、異常な取引量に注意します。Tekel Data はこれらのシグナルを集約し、一目で判断できるようにしています。' },
        { q: 'キュラソーやアンジュアンのライセンスがあれば安全ですか？', a: 'ごく弱い意味でのみです。これらのライセンスは安価で、英国やマルタの規制に比べプレイヤーへの実質的救済はほとんどありません。ライセンスは小さなプラス材料に過ぎず、保証ではありません。検証可能なオンチェーン準備金と支払実績の方がはるかに重要です。' },
        { q: 'プロバブリーフェアなら自動的に安全ですか？', a: 'いいえ。プロバブリーフェアは個々のゲーム結果が改ざんされていないことを証明しますが、運営者が出金を賄えるかは何も語りません。公正性と支払能力は別物で、公正なカジノでも債務超過や支払拒否は起こり得ます。' },
      ],
      related: `<a href="/rankings/trust">信頼ランキング</a>、<a href="/crypto-casinos-with-proof-of-reserves">準備金証明のあるカジノ</a>、運営者ごとの<a href="/guide/how-to-verify-a-crypto-casino">オンチェーン検証方法</a>、中立の<a href="/risk">リスクレジストリ</a>をあわせてご覧ください。18歳以上限定。<a href="/responsible-gambling">責任あるギャンブルを</a>。`,
    },
    ko: {
      h1: '암호화폐 카지노는 안전한가?',
      title: `암호화폐 카지노는 안전할까? 온체인 데이터로 판단하는 법 | Tekel Data`,
      description: `암호화폐 카지노는 안전한가. 실제로 자금을 위험에 빠뜨리는 요소와, 견실한 운영사와 위험한 운영사를 가르는 온체인·제3자 신호를 실용적 체크리스트와 함께 설명합니다.`,
      intro: `"암호화폐 카지노는 안전한가"에는 하나의 답이 없습니다. 안전성은 운영사마다 다르며, 추측이 아니라 <strong>측정</strong>할 수 있습니다. 이 가이드는 실제로 자금을 위험에 빠뜨리는 요인, 라이선스가 지켜주는 것과 아닌 것, "프로버블리 페어"와 지급 능력의 차이, 그리고 직접 검증할 수 있는 신호에 기반한 입금 전 체크리스트를 제시합니다.`,
      sections: [
        { h: '진짜 위험(과 괜히 걱정하는 위험)', body: `<p>대부분의 암호화폐 카지노는 무면허이거나 규제가 느슨한 관할권의 라이선스를 갖고 있어, 자금을 회수해 줄 규제 기관이 거의 없습니다. 가장 큰 위험은 조작된 게임이 아니라——프로버블리 페어는 흔하고 수학적으로 검증 가능합니다——<strong>운영사의 지급 능력과 행위</strong>입니다. 즉 먹튀(엑시트 스캠), 조용한 지급 불능, 또는 동결·제한·과도한 인증 요구로 묻히는 출금입니다. 플레이어는 게임 공정성을 과도하게 걱정하고 운영사가 실제로 지급할 수 있는지는 과소평가하는 경향이 있습니다. 실사는 후자에 집중해야 합니다.</p>` },
        { h: '라이선스가 의미하는 것과 아닌 것', body: `<p>퀴라소나 안주안 라이선스는 취득 비용이 저렴하고 플레이어에게 실질적 구제책이 거의 없습니다. 영국이나 몰타 라이선스의 소비자 보호보다는 사업자 등록에 가깝습니다. 라이선스가 무의미하지는 않지만(어느 정도의 KYC/AML과 취소 가능한 허가를 의미), <strong>약한 신호</strong>로 취급하고 보증으로 여기지 마세요. 라이선스 배지를 운영사가 자금을 보유하고 지급하는지 확인하는 일의 대체물로 삼지 마세요. 이 분야에서 가장 강한 보호는 규제가 아니라 <strong>투명성과 검증 가능한 온체인 행동</strong>입니다.</p>` },
        { h: '프로버블리 페어 ≠ 지급 능력', body: `<p>프로버블리 페어 암호 기술은 특정 베팅 결과가 조작되지 않았음을 검증합니다. 유용하지만, 카지노가 당신의 출금을 감당할 수 있는지는 전혀 말해주지 않습니다. 운영사는 완벽히 공정한 게임을 운영하면서도 지급 불능에 빠지거나 지급을 거부할 수 있습니다. 공정성과 지급 능력은 별개의 축입니다. 암호 원리는 <a href="/guide/provably-fair-explained">프로버블리 페어 설명</a>을 참고하고, 자금 문제와는 분리해서 생각하세요.</p>` },
        { h: '더 안전한 운영사의 신호', body: `<p>최근 출금 흐름을 여유 있게 감당하는 검증 가능한 건전한 <a href="/proof-of-reserves">온체인 준비금</a>. 일관된 출금 보고를 동반한 긴 운영 이력. 대체로 <em>일치</em>하는 복수의 독립 신뢰 평가(casino.guru, Trustpilot, AskGamblers). 입금과 출금이 모두 움직이는 균형 잡힌 온체인 흐름. 그리고 최근 불만 급증이 없을 것. 우리는 제3자 평가를 하나의 독립 <a href="/rankings/trust">신뢰 점수</a>로 통합해 수작업 비교를 없앱니다.</p>` },
        { h: '위험 신호(레드 플래그)', body: `<p>검증할 수 없거나 출금 시기에만 급증하는 준비금. 운영사 평판과 크게 어긋나는 온체인 거래량(우리가 특집하지 않고 <em>검토 중</em>으로 보류하는 워시/트레저리 패턴). 출금 불만의 갑작스러운 폭증. 대응 출금이 거의 없는 입금(플레이어가 지급받지 못할 수 있음). 그리고 자금이 사실상 묶일 만큼 높은 배팅 조건의 보너스. 단일 신호로 단정할 수 없습니다——위험은 <strong>신호의 군집</strong>에 있습니다. 오래된 불만 하나는 잡음이지만, 준비금 감소 + 일방향 유출 + 불만의 물결은 패턴입니다.</p>` },
        { h: '입금 전 체크리스트', body: `<p>계정에 입금하기 전에: (1) 운영사에 <a href="/crypto-casinos-with-proof-of-reserves">온체인 준비금</a>이 매핑되어 안정적인지 확인한다. (2) 둘 이상의 독립 리뷰 출처가 대체로 일치하는지 확인한다. (3) 최근 불만에 <em>미해결 출금</em> 테마가 있는지 살핀다. (4) 보너스/배팅 조건을 동의 전에 읽는다. (5) 실제 자금을 투입하기 전에 소액 테스트 입금과 테스트 출금을 한다. 특별할 것 없는, 회피 가능한 손실과 회피된 손실을 가르는 5분입니다.</p>` },
      ],
      faqs: [
        { q: '암호화폐 카지노는 안전하게 사용할 수 있나요?', a: '전적으로 운영사에 달렸습니다. 가장 큰 위험은 게임 공정성이 아니라 지급 능력과 행위(먹튀, 출금 동결)입니다. 검증 가능한 온체인 준비금, 긴 실적, 일관된 독립 평가를 갖춘 운영사를 택하고, 항상 먼저 소액 테스트 출금을 하세요.' },
        { q: '암호화폐 카지노가 정당한지 어떻게 확인하나요?', a: '블록 익스플로러에서 온체인 준비금을 검증하고, 복수의 독립 리뷰 출처가 일치하는지 확인하며, 최근 불만에 미해결 출금 테마가 있는지 살피고, 비정상적 거래량에 주의합니다. Tekel Data는 이 신호들을 집계해 한눈에 판단하도록 돕습니다.' },
        { q: '퀴라소나 안주안 라이선스가 있으면 안전한가요?', a: '아주 약한 의미에서만입니다. 이 라이선스는 저렴하고 영국·몰타 규제에 비해 플레이어에 대한 실질적 구제가 거의 없습니다. 라이선스는 작은 긍정 요소일 뿐 보증이 아닙니다. 검증 가능한 온체인 준비금과 지급 실적이 훨씬 중요합니다.' },
        { q: '프로버블리 페어면 자동으로 안전한가요?', a: '아니요. 프로버블리 페어는 개별 게임 결과가 조작되지 않았음을 증명할 뿐, 운영사가 출금을 감당할 수 있는지는 말하지 않습니다. 공정성과 지급 능력은 별개이며, 공정한 카지노도 지급 불능이 되거나 지급을 거부할 수 있습니다.' },
      ],
      related: `<a href="/rankings/trust">신뢰 랭킹</a>, <a href="/crypto-casinos-with-proof-of-reserves">준비금 증명이 있는 카지노</a>, 운영사별 <a href="/guide/how-to-verify-a-crypto-casino">온체인 검증 방법</a>, 중립적 <a href="/risk">리스크 레지스트리</a>를 함께 확인하세요. 18세 이상 전용. <a href="/responsible-gambling">책임 있는 게임을</a>.`,
    },
    pt: {
      h1: 'Cassinos cripto são seguros?',
      title: `Cassinos Cripto São Seguros? Como Avaliar com Dados On-Chain | Tekel Data`,
      description: `Cassinos cripto são seguros? O que realmente coloca seus fundos em risco e os sinais on-chain e de terceiros que separam operadores sólidos dos arriscados — com um checklist prático.`,
      intro: `"Cassinos cripto são seguros?" não tem resposta única — a segurança é por operador, e você pode <strong>medi-la</strong> em vez de adivinhar. Este guia mostra o que de fato coloca seus fundos em risco, o que uma licença protege (e o que não protege), por que "provably fair" não é o mesmo que solvência, e um checklist pré-depósito baseado em sinais que você mesmo pode verificar.`,
      sections: [
        { h: 'Os riscos reais (e os que preocupam à toa)', body: `<p>A maioria dos cassinos cripto é não licenciada ou licenciada em jurisdições permissivas, então raramente há um regulador que recupere seus fundos. O risco dominante não é um jogo viciado — sistemas provably-fair são comuns e matematicamente verificáveis — é a <strong>solvência e conduta do operador</strong>: um golpe de saída (exit scam), insolvência silenciosa, ou saques congelados, limitados ou soterrados sob exigências impossíveis de verificação. Jogadores tendem a se preocupar demais com a justiça do jogo e de menos com se o operador consegue de fato pagá-los. Sua diligência deve focar no segundo.</p>` },
        { h: 'O que uma licença significa (e o que não)', body: `<p>Uma licença de Curaçao ou Anjouan é barata de obter e oferece pouca proteção prática ao jogador — está mais para um registro comercial do que para a proteção ao consumidor de uma licença do Reino Unido ou de Malta. Não é nada (implica algum processo de KYC/AML e uma permissão revogável), mas trate-a como um <strong>sinal fraco</strong>, não uma garantia. Não deixe o selo de licença substituir a verificação de que o operador mantém fundos e paga. As proteções mais fortes aqui não são regulatórias; são <strong>transparência e comportamento on-chain verificável</strong>.</p>` },
        { h: 'Provably fair ≠ solvente', body: `<p>A criptografia provably-fair permite verificar que o resultado de uma aposta específica não foi adulterado. Isso é útil, mas não diz nada sobre se o cassino consegue financiar seu saque. Um operador pode rodar jogos perfeitamente justos e ainda assim ficar insolvente ou se recusar a pagar. Justiça e solvência são eixos independentes — veja <a href="/guide/provably-fair-explained">provably fair explicado</a> para a criptografia e mantenha isso mentalmente separado da questão do dinheiro.</p>` },
        { h: 'Sinais de um operador mais seguro', body: `<p><a href="/proof-of-reserves">Reservas on-chain</a> saudáveis e verificáveis que cobrem com folga o fluxo recente de saques; um longo histórico operacional com relatos consistentes de pagamento; várias avaliações independentes (casino.guru, Trustpilot, AskGamblers) que em geral <em>concordam</em>; fluxo on-chain equilibrado nos dois sentidos (depósitos e saques em movimento); e a ausência de um pico recente de reclamações. Combinamos as avaliações de terceiros em um único <a href="/rankings/trust">score de confiança</a> independente para você não precisar ponderá-las à mão.</p>` },
        { h: 'Sinais de alerta (red flags)', body: `<p>Reservas que não podem ser verificadas ou que sobem apenas perto dos períodos de saque; volume on-chain totalmente fora de linha com a reputação do operador (um padrão de wash/tesouraria que mantemos <em>em análise</em> em vez de destacar); uma enxurrada súbita de reclamações de saque; depósitos com quase nenhum fluxo de saída correspondente (jogadores podem não estar sendo pagos); e termos de bônus com exigências de aposta tão altas que os fundos ficam efetivamente travados. Nenhum sinal isolado é conclusivo — o risco vive em <strong>conjuntos</strong>. Uma reclamação antiga é ruído; reservas caindo, mais fluxo unidirecional, mais uma onda de reclamações é um padrão.</p>` },
        { h: 'Um checklist pré-depósito', body: `<p>Antes de depositar em qualquer conta: (1) verifique se o operador tem <a href="/crypto-casinos-with-proof-of-reserves">reservas on-chain</a> mapeadas e estáveis; (2) confirme que duas ou mais fontes de avaliação independentes concordam em geral; (3) examine reclamações recentes especificamente por um tema de <em>saque não resolvido</em>; (4) leia os termos de bônus/aposta antes de aceitar; (5) comece com um pequeno depósito de teste e um saque de teste antes de comprometer valores reais. Nada disso é exótico — são os mesmos cinco minutos que separam a maioria das perdas evitáveis das evitadas.</p>` },
      ],
      faqs: [
        { q: 'Cassinos cripto são seguros de usar?', a: 'Depende inteiramente do operador. O maior risco é solvência e conduta (golpes de saída, saques congelados), não a justiça do jogo. Prefira operadores com reservas on-chain verificáveis, longo histórico e avaliações independentes consistentes, e sempre faça primeiro um pequeno saque de teste.' },
        { q: 'Como posso verificar se um cassino cripto é confiável?', a: 'Verifique suas reservas on-chain em um explorador de blocos, confira se várias fontes de avaliação independentes concordam, examine reclamações recentes por temas de saque não resolvido e observe volume anômalo. Nós agregamos esses sinais para você avaliar num relance.' },
        { q: 'Uma licença de Curaçao ou Anjouan torna um cassino seguro?', a: 'Apenas de forma fraca. Essas licenças são baratas e oferecem pouca proteção prática ao jogador em comparação com a regulação do Reino Unido ou de Malta. Trate a licença como um pequeno ponto positivo, não uma garantia — reservas on-chain verificáveis e um histórico de pagamentos importam muito mais.' },
        { q: 'Um cassino provably-fair é automaticamente seguro?', a: 'Não. Provably-fair prova que resultados individuais não foram adulterados; não diz nada sobre se o operador consegue financiar seu saque. Justiça e solvência são separadas — um cassino justo ainda pode ficar insolvente ou se recusar a pagar.' },
      ],
      related: `Use nosso <a href="/rankings/trust">ranking de confiança</a>, os <a href="/crypto-casinos-with-proof-of-reserves">cassinos com prova de reservas</a>, a <a href="/guide/how-to-verify-a-crypto-casino">verificação on-chain por operador</a> e o <a href="/risk">registro de risco</a> neutro. Somente maiores de 18. <a href="/responsible-gambling">Jogue com responsabilidade</a>.`,
    },
  },

  'how-to-verify-a-crypto-casino': {
    ja: {
      h1: '仮想通貨カジノをオンチェーンで検証する方法',
      title: `仮想通貨カジノをオンチェーンで検証する方法（手順解説） | Tekel Data`,
      description: `公開ブロックチェーンデータを使って自分でカジノを確認する手順：ウォレットの特定、準備金の読み取り、取引量の健全性チェック、ウォッシュ/財務チャーンの見分け方。`,
      intro: `カジノの言い分を鵜呑みにする必要はありません——ブロックチェーンは公開されています。これは私たちが運営者を検証する実際の手順です：ウォレットを見つけ、各チェーンの正しいエクスプローラーで準備金を読み、本物のプレイヤーフローと財務チャーンを見分け、誤った結論に至る落とし穴を避ける方法です。`,
      sections: [
        { h: 'ステップ1 — ウォレットを見つける', body: `<p>公開ブロックエクスプローラーのネームタグ（Etherscan の「Public Name Tag」、Tronscan のラベル）とオンチェーンの挙動——カジノのキャッシャーが送受信するアドレス——から、運営者のホット/入金ウォレットを特定します。確認済みの入金アドレス一つを、共通入力所有（common-input-ownership）でウォレット<em>クラスタ</em>へ拡張できます。同一トランザクションで繰り返し共に使われるアドレスは、ほぼ確実に同一主体が管理しています。私たちは運営者ごとにマッピングしたウォレットを公開しているので、推測ではなく既知の良好なアドレスから始められます。</p>` },
        { h: 'ステップ2 — チェーンに合うエクスプローラーを選ぶ', body: `<p>各チェーンには独自のエクスプローラーがあります：<strong>Ethereum</strong> → Etherscan、<strong>Tron</strong>（USDTカジノフローの多くが決済される）→ Tronscan、<strong>BSC</strong> → BscScan、<strong>Polygon</strong> → Polygonscan、<strong>Bitcoin</strong> → mempool.space または Blockstream、<strong>Solana</strong> → Solscan。カジノの準備金はほぼ常にマルチチェーンなので、一つのネットワークだけを見ると過小評価になります。ウォレットアドレスをエクスプローラーの検索に貼り付け、「Token holdings」/残高ビューを開きます。</p>` },
        { h: 'ステップ3 — 準備金を読む', body: `<p>各エクスプローラーで、ウォレットのステーブルコイン（USDT、USDC）と主要資産の残高を読み、運営者のマッピング済み全ウォレット・全チェーンで合算します——その合計が追跡対象の<a href="/proof-of-reserves">準備金</a>です。見出しの数字より二つの読みが重要です：<strong>トレンド</strong>（残高は安定/増加しているか、それとも支払時期にだけ現れるか）と、出金フローに対する<strong>相対的な規模</strong>です。出金ウィンドウ直後に流出する大きな残高は、支払能力ではなく「見せかけ」パターンです。</p>` },
        { h: 'ステップ4 — 取引量の健全性を確認する', body: `<p>総「取引量」ではなく、入出金<em>フロー</em>を見ます。本物のプレイヤーフローは多数の小口送金——平均で数千ドル程度です。平均送金額が大きい、または二つのアドレスがほぼ同額を行き来させている場合、プレイヤーではなく財務のリバランスやマーケットメイクのチャーンを示します。私たちはそのチャーン（および内部ホットウォレットの移動、二重計上）を数値から除外します。多くのトラッカーはそれをせず、だから見出しの取引量が桁違いに膨張して見えるのです。カジノの「取引量」が評判に対して桁外れなら、人気ではなくウォッシュ/財務シグナルとして扱ってください。</p>` },
        { h: 'ステップ5 — 一つの数字を鵜呑みにせず裏取りする', body: `<p>オンチェーンの帰属には本質的な不確実性があります——ウォレットは誤ラベルされ得るし、クラスタリングは証明ではなくヒューリスティックです。だから相互チェックします：独立評価（casino.guru、Trustpilot、AskGamblers）はおおむね一致しているか。直近に<em>未解決の出金</em>という苦情テーマはあるか。準備金の状況は運営者の主張と一致するか。独立した複数の情報源による裏取りこそが要点です——オンチェーンであれオフチェーンであれ、単一のシグナルは誤解を招き得ます。私たちの<a href="/methodology/address-attribution">帰属方法論</a>は、各数値の算出方法と不確実性の所在を正確に記載しています。</p>` },
        { h: '検証時によくある間違い', body: `<p>誤った結論を生む間違い：一つのチェーンだけを確認する（準備金の過小評価）。総取引量をプレイヤー活動と読む（チャーンを含めて過大計上）。背後の挙動を確認せずネームタグを信じる。単一スナップショットを恒久と扱う（残高はブロックごとに動く）。関連するが別個の製品を主ブランドと混同する（例：".us" 姉妹サイトは別の運営者）。迷ったら期間を広げ、瞬間ではなくトレンドを見てください。</p>` },
      ],
      faqs: [
        { q: '仮想通貨カジノを自分で検証できますか？', a: 'はい。ウォレットが判明すれば、公開ブロックエクスプローラー（Ethereum は Etherscan、Tron は Tronscan など）で残高とフローを直接読めます。私たちはマッピング済みウォレットと数値を提示し、素早く行えるようにしています。' },
        { q: '仮想通貨カジノにはどのブロックエクスプローラーを使うべき？', a: 'チェーンに合わせます：Etherscan（Ethereum）、Tronscan（Tron——USDTカジノフローの多くが決済）、BscScan（BSC）、Polygonscan（Polygon）、Solscan（Solana）、mempool.space（Bitcoin）。準備金は通常マルチチェーンなので、運営者が使う全チェーンを確認してください。' },
        { q: '仮想通貨カジノの健全な準備金水準とは？', a: '固定の数字はありませんが、準備金は短期の出金需要を余裕を持って上回り、時間とともに安定または増加すべきで、出金時にだけ急増すべきではありません。単独で見るのではなく、純フローと比較してください。' },
        { q: 'なぜカジノのオンチェーン取引量は予想よりずっと高いのか？', a: 'ほとんどのトラッカーは総取引量を報告し、内部ホットウォレットのチャーン、二重計上、財務/マーケットメイクの移動を含みます。本物のプレイヤーフローは多数の小口送金です。平均送金額が大きいのはプレイヤーではなくチャーンの兆候で、私たちはそれを除外します。だから私たちの数値は低く、より現実的です。' },
      ],
      related: `<a href="/crypto-casinos-with-proof-of-reserves">準備金証明リスト</a>、<a href="/highest-volume-crypto-casinos">検証済み取引量ランキング</a>、<a href="/methodology/address-attribution">帰属方法論</a>、さらに詳しい<a href="/guide/crypto-casino-proof-of-reserves">準備金証明の解説</a>をご活用ください。`,
    },
    ko: {
      h1: '암호화폐 카지노를 온체인으로 검증하는 법',
      title: `암호화폐 카지노를 온체인으로 검증하는 법(단계별) | Tekel Data`,
      description: `공개 블록체인 데이터로 직접 카지노를 확인하는 절차: 지갑 찾기, 준비금 읽기, 거래량 건전성 점검, 워시/트레저리 처닝 구별하기.`,
      intro: `카지노의 말을 그대로 믿을 필요는 없습니다——블록체인은 공개되어 있습니다. 이것은 우리가 운영사를 검증하는 실제 절차입니다: 지갑을 찾고, 체인별로 올바른 익스플로러에서 준비금을 읽고, 진짜 플레이어 흐름과 트레저리 처닝을 구별하고, 잘못된 결론으로 이끄는 실수를 피하는 방법입니다.`,
      sections: [
        { h: '1단계 — 지갑 찾기', body: `<p>공개 블록 익스플로러의 네임태그(Etherscan의 "Public Name Tag", Tronscan 라벨)와 온체인 행동——카지노 캐셔가 주고받는 주소——에서 운영사의 핫/입금 지갑을 식별합니다. 확인된 입금 주소 하나를 공통 입력 소유(common-input-ownership)로 지갑 <em>클러스터</em>로 확장할 수 있습니다. 같은 트랜잭션에서 반복적으로 함께 사용되는 주소는 거의 확실히 동일 주체가 통제합니다. 우리는 운영사별로 매핑한 지갑을 공개하므로, 추측이 아니라 검증된 주소에서 시작할 수 있습니다.</p>` },
        { h: '2단계 — 체인에 맞는 익스플로러 선택', body: `<p>체인마다 고유한 익스플로러가 있습니다: <strong>Ethereum</strong> → Etherscan, <strong>Tron</strong>(대부분의 USDT 카지노 흐름이 정산되는 곳) → Tronscan, <strong>BSC</strong> → BscScan, <strong>Polygon</strong> → Polygonscan, <strong>Bitcoin</strong> → mempool.space 또는 Blockstream, <strong>Solana</strong> → Solscan. 카지노 준비금은 거의 항상 멀티체인이므로, 한 네트워크만 보면 과소 집계됩니다. 지갑 주소를 익스플로러 검색에 붙여넣고 "Token holdings"/잔액 화면을 엽니다.</p>` },
        { h: '3단계 — 준비금 읽기', body: `<p>각 익스플로러에서 지갑의 스테이블코인(USDT, USDC)과 주요 자산 잔액을 읽고, 운영사의 매핑된 모든 지갑·모든 체인에 걸쳐 합산합니다——그 합계가 추적되는 <a href="/proof-of-reserves">준비금</a>입니다. 표면 숫자보다 두 가지 읽기가 더 중요합니다: <strong>추세</strong>(잔액이 안정/증가하는가, 아니면 지급 시기에만 나타나는가)와 출금 흐름 대비 <strong>상대적 규모</strong>입니다. 출금 창구 직후 빠져나가는 큰 잔액은 지급 능력이 아니라 "치장" 패턴입니다.</p>` },
        { h: '4단계 — 거래량 건전성 점검', body: `<p>총 "거래량"이 아니라 입출금 <em>흐름</em>을 봅니다. 진짜 플레이어 흐름은 다수의 소액 이체——평균 수천 달러 수준입니다. 평균 이체 규모가 크거나 두 주소가 거의 같은 금액을 주고받는다면, 플레이어가 아니라 트레저리 리밸런싱이나 마켓메이킹 처닝을 뜻합니다. 우리는 그 처닝(그리고 내부 핫월렛 이동, 이중 계산)을 수치에서 제거합니다. 대부분의 트래커는 그러지 않으며, 그래서 그들의 표면 거래량이 한 자릿수 이상 부풀려 보입니다. 카지노의 "거래량"이 평판에 비해 지나치게 크면, 인기가 아니라 워시/트레저리 신호로 취급하세요.</p>` },
        { h: '5단계 — 숫자 하나를 믿지 말고 교차 검증', body: `<p>온체인 귀속에는 본질적 불확실성이 있습니다——지갑은 잘못 라벨될 수 있고, 클러스터링은 증명이 아니라 휴리스틱입니다. 그래서 교차 확인합니다: 독립 평가(casino.guru, Trustpilot, AskGamblers)가 대체로 일치하는가? 최근 <em>미해결 출금</em> 불만 테마가 있는가? 준비금 상황이 운영사 주장과 일치하는가? 독립적 복수 출처의 교차 검증이 핵심입니다——온체인이든 오프체인이든 단일 신호는 오도할 수 있습니다. 우리의 <a href="/methodology/address-attribution">귀속 방법론</a>은 각 수치의 산출 방식과 불확실성의 위치를 정확히 문서화합니다.</p>` },
        { h: '검증 시 흔한 실수', body: `<p>잘못된 결론을 낳는 실수: 한 체인만 확인(준비금 과소 집계); 총 거래량을 플레이어 활동으로 읽음(처닝 포함해 과대 집계); 뒤의 행동을 점검하지 않고 네임태그를 신뢰; 단일 스냅샷을 영구로 취급(잔액은 블록마다 변함); 관련되지만 별개인 제품을 주 브랜드와 혼동(예: ".us" 자매 사이트는 다른 운영사). 의심스러우면 기간을 넓히고, 순간이 아니라 추세를 보세요.</p>` },
      ],
      faqs: [
        { q: '암호화폐 카지노를 직접 검증할 수 있나요?', a: '네. 지갑이 파악되면 공개 블록 익스플로러(Ethereum은 Etherscan, Tron은 Tronscan 등)에서 잔액과 흐름을 직접 읽을 수 있습니다. 우리는 매핑된 지갑과 수치를 제공해 빠르게 할 수 있도록 합니다.' },
        { q: '암호화폐 카지노에는 어떤 블록 익스플로러를 써야 하나요?', a: '체인에 맞춥니다: Etherscan(Ethereum), Tronscan(Tron——대부분의 USDT 카지노 흐름 정산), BscScan(BSC), Polygonscan(Polygon), Solscan(Solana), mempool.space(Bitcoin). 준비금은 보통 멀티체인이므로 운영사가 쓰는 모든 체인을 확인하세요.' },
        { q: '암호화폐 카지노의 건전한 준비금 수준은?', a: '고정된 숫자는 없지만, 준비금은 단기 출금 수요를 여유 있게 초과하고 시간이 지나며 안정 또는 증가해야 하며, 출금 때만 급증해서는 안 됩니다. 단독으로 보지 말고 순흐름과 비교하세요.' },
        { q: '카지노의 온체인 거래량이 왜 예상보다 훨씬 높은가요?', a: '대부분의 트래커는 내부 핫월렛 처닝, 이중 계산, 트레저리/마켓메이킹 이동을 포함한 총 거래량을 보고합니다. 진짜 플레이어 흐름은 다수의 소액 이체입니다. 평균 이체 규모가 큰 것은 플레이어가 아니라 처닝의 신호이며, 우리는 이를 제외합니다. 그래서 우리 수치가 더 낮고 현실적입니다.' },
      ],
      related: `<a href="/crypto-casinos-with-proof-of-reserves">준비금 증명 목록</a>, <a href="/highest-volume-crypto-casinos">검증된 거래량 랭킹</a>, <a href="/methodology/address-attribution">귀속 방법론</a>, 그리고 더 자세한 <a href="/guide/crypto-casino-proof-of-reserves">준비금 증명 설명</a>을 활용하세요.`,
    },
    pt: {
      h1: 'Como verificar um cassino cripto on-chain',
      title: `Como Verificar um Cassino Cripto On-Chain (Passo a Passo) | Tekel Data`,
      description: `Um guia passo a passo para checar você mesmo um cassino cripto usando dados públicos da blockchain: encontrar as carteiras, ler reservas, conferir o volume e detectar churn de wash/tesouraria.`,
      intro: `Você não precisa acreditar na palavra de um cassino sobre nada — a blockchain é pública. Este é o processo exato que usamos para verificar um operador: encontrar suas carteiras, ler reservas no explorador certo de cada rede, distinguir fluxo real de jogadores do churn de tesouraria, e os erros que levam a conclusões equivocadas.`,
      sections: [
        { h: 'Passo 1 — encontre as carteiras', body: `<p>Identifique as carteiras hot/de depósito do operador pelas name-tags de exploradores públicos (o "Public Name Tag" do Etherscan, rótulos do Tronscan) e pelo comportamento on-chain — os endereços para os quais o caixa do cassino envia e dos quais recebe. Um único endereço de depósito confirmado pode ser expandido para um <em>cluster</em> de carteiras via common-input-ownership: endereços repetidamente gastos juntos na mesma transação quase sempre são controlados pela mesma entidade. Publicamos as carteiras que mapeamos por operador, então você começa de um endereço confiável em vez de adivinhar.</p>` },
        { h: 'Passo 2 — escolha o explorador certo para a rede', body: `<p>Cada rede tem seu explorador: <strong>Ethereum</strong> → Etherscan; <strong>Tron</strong> (onde a maior parte do fluxo de USDT de cassinos é liquidada) → Tronscan; <strong>BSC</strong> → BscScan; <strong>Polygon</strong> → Polygonscan; <strong>Bitcoin</strong> → mempool.space ou Blockstream; <strong>Solana</strong> → Solscan. As reservas de cassinos quase sempre são multi-rede, então checar apenas uma rede subestima o total. Cole o endereço da carteira na busca do explorador e abra a visão de "Token holdings"/saldo.</p>` },
        { h: 'Passo 3 — leia as reservas', body: `<p>Em cada explorador, leia o saldo da carteira em stablecoins (USDT, USDC) e ativos principais, e some em todas as carteiras e redes mapeadas do operador — esse total são as <a href="/proof-of-reserves">reservas</a> rastreadas. Duas leituras importam mais que o número de manchete: a <strong>tendência</strong> (o saldo é estável/crescente, ou só aparece perto dos pagamentos?) e o tamanho <strong>relativo ao fluxo de saques</strong>. Um saldo grande que se esvazia logo após uma janela de saque é um padrão de fachada, não solvência.</p>` },
        { h: 'Passo 4 — confira o volume', body: `<p>Olhe o <em>fluxo</em> de depósito/saque, não o "volume" bruto. Fluxo real de jogadores são muitas transferências pequenas — da ordem de alguns milhares de dólares em média. Um tamanho médio de transferência alto, ou dois endereços embaralhando valores quase idênticos, sinaliza rebalanceamento de tesouraria ou churn de market-making, não jogadores. Removemos esse churn (e a movimentação interna de hot wallets e a dupla contagem) dos nossos números; a maioria dos rastreadores não, e por isso os volumes de manchete deles parecem inflados em uma ordem de grandeza. Se o "volume" de um cassino ofusca sua reputação, trate como sinal de wash/tesouraria, não popularidade.</p>` },
        { h: 'Passo 5 — corrobore, não confie em um único número', body: `<p>A atribuição on-chain carrega incerteza inerente — uma carteira pode ser mal rotulada, e o clustering é heurístico, não prova. Então cruze fontes: as avaliações independentes (casino.guru, Trustpilot, AskGamblers) concordam em geral? Há um tema recente de reclamação de <em>saque não resolvido</em>? O quadro de reservas bate com o que o operador afirma? A corroboração entre fontes independentes é o ponto central — qualquer sinal isolado, on-chain ou não, pode enganar. Nossa <a href="/methodology/address-attribution">metodologia de atribuição</a> documenta exatamente como cada número é produzido e onde mora a incerteza.</p>` },
        { h: 'Erros comuns ao verificar', body: `<p>Os erros que produzem conclusões erradas: checar apenas uma rede (subestima reservas); ler volume bruto como atividade de jogadores (superestima ao incluir churn); confiar numa name-tag sem conferir o comportamento por trás; tratar um único snapshot como permanente (saldos mudam a cada bloco); e confundir um produto relacionado mas distinto com a marca principal (ex.: um site irmão ".us" é outro operador). Na dúvida, amplie a janela e olhe a tendência, não o instante.</p>` },
      ],
      faqs: [
        { q: 'Posso verificar um cassino cripto sozinho?', a: 'Sim. Uma vez conhecidas as carteiras, você lê saldos e fluxos diretamente em um explorador de blocos público — Etherscan para Ethereum, Tronscan para Tron, e assim por diante. Nós expomos as carteiras mapeadas e os números para tornar isso rápido.' },
        { q: 'Qual explorador de blocos usar para um cassino cripto?', a: 'Combine o explorador com a rede: Etherscan (Ethereum), Tronscan (Tron — onde a maior parte do fluxo de USDT de cassinos é liquidada), BscScan (BSC), Polygonscan (Polygon), Solscan (Solana), mempool.space (Bitcoin). As reservas costumam ser multi-rede, então cheque todas as redes que o operador usa.' },
        { q: 'Qual é um nível saudável de reservas para um cassino cripto?', a: 'Não há número fixo, mas as reservas devem exceder com folga a demanda de saques de curto prazo e permanecer estáveis ou crescer ao longo do tempo — não picar apenas perto dos saques. Compare as reservas ao fluxo líquido em vez de vê-las isoladamente.' },
        { q: 'Por que o volume on-chain de um cassino é tão maior que o esperado?', a: 'A maioria dos rastreadores reporta volume bruto, que inclui churn interno de hot wallets, dupla contagem e movimentação de tesouraria/market-making. O fluxo real de jogadores são muitas transferências pequenas. Um tamanho médio de transferência alto sinaliza churn, não jogadores — nós o excluímos, e por isso nossos volumes são menores e mais realistas.' },
      ],
      related: `Use nossa <a href="/crypto-casinos-with-proof-of-reserves">lista de prova de reservas</a>, o <a href="/highest-volume-crypto-casinos">ranking de volume verificado</a>, a <a href="/methodology/address-attribution">metodologia de atribuição</a> e o <a href="/guide/crypto-casino-proof-of-reserves">explicador mais aprofundado de prova de reservas</a>.`,
    },
  },
}
