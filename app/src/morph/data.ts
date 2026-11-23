import TABLE from './table.json'

export type MorphType = 'pre' | 'root' | 'suf' | 'base'

export interface Morpheme {
  id: string
  t: MorphType
  main: string
  zh: string
  vars: string[]
  rules?: Record<string, string>
  hist?: string[]
  rel?: string[]
  ai?: boolean
}

export type Part = [string, string] | [string, 'base', string]

export interface Decomp {
  z: string
  p: string
  parts: Part[]
  x?: string
}

const BASE_LIB: Morpheme[] = [
  {"id": "in_neg", "t": "pre", "main": "in-", "zh": "不，非", "vars": ["in", "im", "il", "ir"], "rules": {"im": "遇 p / b / m 同化为 im-", "il": "遇 l 同化为 il-", "ir": "遇 r 同化为 ir-"}, "rel": ["un", "dis"]},
  {"id": "in_into", "t": "pre", "main": "in-", "zh": "向内，进入", "vars": ["in", "im"], "rules": {"im": "遇 p / b / m 同化为 im-"}, "rel": ["ex", "ad"]},
  {"id": "un", "t": "pre", "main": "un-", "zh": "不，相反", "vars": ["un"], "rel": ["in_neg", "dis"]},
  {"id": "dis", "t": "pre", "main": "dis-", "zh": "不，否定；分开，除去", "vars": ["dis"], "rel": ["un", "in_neg"]},
  {"id": "re", "t": "pre", "main": "re-", "zh": "再，重新；向后，回", "vars": ["re"]},
  {"id": "pre", "t": "pre", "main": "pre-", "zh": "预先", "vars": ["pre"], "rel": ["pro"]},
  {"id": "de", "t": "pre", "main": "de-", "zh": "向下；去除；加强", "vars": ["de"]},
  {"id": "ex", "t": "pre", "main": "ex-", "zh": "向外，出；以前的", "vars": ["ex", "e", "ef"], "rules": {"e": "在 r / m / l / v 等辅音前简化为 e-", "ef": "遇 f 同化为 ef-"}, "rel": ["in_into"]},
  {"id": "con", "t": "pre", "main": "con-", "zh": "共同，一起", "vars": ["con", "com", "col", "cor", "co"], "rules": {"com": "遇 p / b / m 同化为 com-", "col": "遇 l 同化为 col-", "cor": "遇 r 同化为 cor-"}},
  {"id": "sub", "t": "pre", "main": "sub-", "zh": "在下面", "vars": ["sub", "sus", "sup", "suc"], "rules": {"sus": "遇 t / c / p 时常写作 sus-", "sup": "遇 p 同化为 sup-", "suc": "遇 c 同化为 suc-"}, "rel": ["de"]},
  {"id": "ad", "t": "pre", "main": "ad-", "zh": "朝向", "vars": ["ad", "ac", "at", "ap", "as"], "rules": {"ac": "遇 c 同化为 ac-", "at": "遇 t 同化为 at-", "ap": "遇 p 同化为 ap-", "as": "遇 s 同化为 as-"}},
  {"id": "trans", "t": "pre", "main": "trans-", "zh": "跨越", "vars": ["trans"]},
  {"id": "inter", "t": "pre", "main": "inter-", "zh": "在…之间", "vars": ["inter"]},
  {"id": "pro", "t": "pre", "main": "pro-", "zh": "向前", "vars": ["pro"], "rel": ["pre"]},
  {"id": "mis", "t": "pre", "main": "mis-", "zh": "错误地", "vars": ["mis"]},
  {"id": "pati", "t": "root", "main": "pati", "zh": "忍受，承受", "vars": ["pati", "pass"], "rules": {"pass": "同源变体 pass（源自过去分词 passus）"}},
  {"id": "rod", "t": "root", "main": "rod", "zh": "啃，咬", "vars": ["rod", "rode", "ros"], "rules": {"ros": "接 -ion / -ive 时 d → s"}},
  {"id": "ten", "t": "root", "main": "ten", "zh": "握住，保持", "vars": ["ten", "tain", "tin"], "rules": {"tain": "动词形式写作 -tain"}, "rel": ["tend", "cept"]},
  {"id": "tend", "t": "root", "main": "tend", "zh": "伸展，趋向", "vars": ["tend", "tent", "tens"], "rules": {"tent": "名词形式 d → t", "tens": "名词形式 d → s"}, "rel": ["ten"]},
  {"id": "cid", "t": "root", "main": "cid", "zh": "切，断", "vars": ["cid", "cide", "cis", "cise"], "rules": {"cis": "接 -ive / -ion 时 -de → -s-", "cise": "形容词形式 -de → -se"}},
  {"id": "cept", "t": "root", "main": "cept", "zh": "拿，取", "vars": ["cept", "ceive", "ceiv"], "rules": {"ceive": "动词形式写作 -ceive"}},
  {"id": "spect", "t": "root", "main": "spect", "zh": "看", "vars": ["spect", "spic"]},
  {"id": "form", "t": "root", "main": "form", "zh": "形状，形成", "vars": ["form"]},
  {"id": "duc", "t": "root", "main": "duc", "zh": "引导", "vars": ["duce", "duct", "duc"], "rules": {"duce": "动词形式写作 -duce", "duct": "分词词干 duct"}},
  {"id": "port", "t": "root", "main": "port", "zh": "携带，运送", "vars": ["port"]},
  {"id": "mit", "t": "root", "main": "mit", "zh": "送，发出", "vars": ["mit", "miss"], "rules": {"miss": "名词或分词形式 t → ss"}},
  {"id": "struct", "t": "root", "main": "struct", "zh": "建造", "vars": ["struct"]},
  {"id": "dict", "t": "root", "main": "dict", "zh": "说", "vars": ["dict"]},
  {"id": "vis", "t": "root", "main": "vis", "zh": "看见", "vars": ["vis", "vise", "vid"]},
  {"id": "tract", "t": "root", "main": "tract", "zh": "拉，拖", "vars": ["tract", "treat", "trait", "trac"], "hist": ["treat", "trait"]},
  {"id": "happy", "t": "root", "main": "happ(y)", "zh": "运气，幸运（自由词基）", "vars": ["happy", "happi"], "rules": {"happi": "辅音 + y 接后缀时 y → i"}},
  {"id": "ence", "t": "suf", "main": "-ence", "zh": "n. 性质，状态", "vars": ["ence", "ency"], "rel": ["ance"]},
  {"id": "ance", "t": "suf", "main": "-ance", "zh": "n. 性质，状态", "vars": ["ance", "ancy"], "rel": ["ence"]},
  {"id": "ent", "t": "suf", "main": "-ent", "zh": "adj. …的；n. …者", "vars": ["ent", "ant"]},
  {"id": "ion", "t": "suf", "main": "-ion", "zh": "n. 行为，结果", "vars": ["ion", "tion", "sion", "ation"]},
  {"id": "ness", "t": "suf", "main": "-ness", "zh": "n. 状态", "vars": ["ness"]},
  {"id": "ive", "t": "suf", "main": "-ive", "zh": "adj. 有…倾向的", "vars": ["ive"]},
  {"id": "ate", "t": "suf", "main": "-ate", "zh": "v. 使…；adj. 具有…", "vars": ["ate"]},
  {"id": "able", "t": "suf", "main": "-able", "zh": "adj. 能…的", "vars": ["able"], "rel": ["ible"]},
  {"id": "ible", "t": "suf", "main": "-ible", "zh": "adj. 能…的，可…的", "vars": ["ible"], "rel": ["able"]},
  {"id": "ful", "t": "suf", "main": "-ful", "zh": "adj. 充满…的", "vars": ["ful"]},
  {"id": "less", "t": "suf", "main": "-less", "zh": "adj. 没有…的", "vars": ["less"]},
  {"id": "ly", "t": "suf", "main": "-ly", "zh": "adv. …地", "vars": ["ly"]},
  {"id": "ment", "t": "suf", "main": "-ment", "zh": "n. 行为，结果", "vars": ["ment"]},
  {"id": "ity", "t": "suf", "main": "-ity", "zh": "n. 性质", "vars": ["ity", "ty"]},
  {"id": "er", "t": "suf", "main": "-er", "zh": "n. 做…的人或物", "vars": ["er"], "rel": ["or"]},
  {"id": "or", "t": "suf", "main": "-or", "zh": "n. 做…的人或物", "vars": ["or"], "rel": ["er"]},
  {"id": "al", "t": "suf", "main": "-al", "zh": "adj. …的", "vars": ["al"]},
  {"id": "ize", "t": "suf", "main": "-ize", "zh": "v. 使…化", "vars": ["ize", "ise"]},
]

export const CORE_IDS = new Set(BASE_LIB.map((m) => m.id))

export const LIB: Morpheme[] = [...BASE_LIB, ...(TABLE as Morpheme[])]

export const EXACT: Record<string, Decomp> = {
  "patience": {"z": "耐心", "p": "n.", "parts": [["pati", "pati"], ["ence", "ence"]]},
  "patient": {"z": "有耐心的；病人", "p": "adj.", "parts": [["pati", "pati"], ["ent", "ent"]]},
  "impatient": {"z": "不耐烦的", "p": "adj.", "parts": [["im", "in_neg"], ["pati", "pati"], ["ent", "ent"]], "x": "An impatient reader skips the premise."},
  "impatience": {"z": "不耐烦", "p": "n.", "parts": [["im", "in_neg"], ["pati", "pati"], ["ence", "ence"]], "x": "Her impatience showed in every reply."},
  "patiently": {"z": "耐心地", "p": "adv.", "parts": [["pati", "pati"], ["ent", "ent"], ["ly", "ly"]], "x": "She waited patiently for the results."},
  "passive": {"z": "被动的", "p": "adj.", "parts": [["pass", "pati"], ["ive", "ive"]], "x": "Passive reading rarely builds vocabulary."},
  "passion": {"z": "激情", "p": "n.", "parts": [["pass", "pati"], ["ion", "ion"]], "x": "He spoke about the project with passion."},
  "compassion": {"z": "同情", "p": "n.", "parts": [["com", "con"], ["pass", "pati"], ["ion", "ion"]], "x": "The nurse treated everyone with compassion."},
  "erode": {"z": "侵蚀，削弱", "p": "v.", "parts": [["e", "ex"], ["rode", "rod"]]},
  "erosion": {"z": "侵蚀", "p": "n.", "parts": [["e", "ex"], ["ros", "rod"], ["ion", "ion"]]},
  "erosive": {"z": "侵蚀性的", "p": "adj.", "parts": [["e", "ex"], ["ros", "rod"], ["ive", "ive"]], "x": "Erosive forces reshaped the coast."},
  "corrode": {"z": "腐蚀", "p": "v.", "parts": [["cor", "con"], ["rode", "rod"]]},
  "corrosion": {"z": "腐蚀", "p": "n.", "parts": [["cor", "con"], ["ros", "rod"], ["ion", "ion"]], "x": "Salt speeds up corrosion."},
  "corrosive": {"z": "腐蚀性的", "p": "adj.", "parts": [["cor", "con"], ["ros", "rod"], ["ive", "ive"]], "x": "Corrosive criticism wore the team down."},
  "rodent": {"z": "啮齿动物", "p": "n.", "parts": [["rod", "rod"], ["ent", "ent"]], "x": "A rodent had chewed through the cable."},
  "sustain": {"z": "维持", "p": "v.", "parts": [["sus", "sub"], ["tain", "ten"]]},
  "sustainable": {"z": "可持续的", "p": "adj.", "parts": [["sus", "sub"], ["tain", "ten"], ["able", "able"]], "x": "Sustainable habits outlast motivation."},
  "retain": {"z": "保留", "p": "v.", "parts": [["re", "re"], ["tain", "ten"]], "x": "Spaced practice helps you retain words."},
  "contain": {"z": "包含", "p": "v.", "parts": [["con", "con"], ["tain", "ten"]], "x": "The box contains old letters."},
  "detain": {"z": "拘留，耽搁", "p": "v.", "parts": [["de", "de"], ["tain", "ten"]], "x": "Fog detained the flight for an hour."},
  "retention": {"z": "保留，记忆保持", "p": "n.", "parts": [["re", "re"], ["ten", "ten"], ["tion", "ion"]], "x": "Retention improves with retrieval practice."},
  "intend": {"z": "打算", "p": "v.", "parts": [["in", "in_into"], ["tend", "tend"]], "x": "We intend to finish by Friday."},
  "extend": {"z": "延伸", "p": "v.", "parts": [["ex", "ex"], ["tend", "tend"]], "x": "They extended the deadline."},
  "attention": {"z": "注意力", "p": "n.", "parts": [["at", "ad"], ["tent", "tend"], ["ion", "ion"]]},
  "intention": {"z": "意图", "p": "n.", "parts": [["in", "in_into"], ["tent", "tend"], ["ion", "ion"]]},
  "tension": {"z": "紧张", "p": "n.", "parts": [["tens", "tend"], ["ion", "ion"]], "x": "The tension in the room was obvious."},
  "decide": {"z": "决定", "p": "v.", "parts": [["de", "de"], ["cide", "cid"]]},
  "decision": {"z": "决定", "p": "n.", "parts": [["de", "de"], ["cis", "cid"], ["ion", "ion"]], "x": "It was a hard decision."},
  "decisive": {"z": "决定性的；果断的", "p": "adj.", "parts": [["de", "de"], ["cis", "cid"], ["ive", "ive"]], "x": "Clean data played a decisive role."},
  "precise": {"z": "精确的", "p": "adj.", "parts": [["pre", "pre"], ["cise", "cid"]], "x": "Give a precise answer."},
  "incisive": {"z": "犀利的", "p": "adj.", "parts": [["in", "in_into"], ["cis", "cid"], ["ive", "ive"]], "x": "Her review was short and incisive."},
  "receive": {"z": "收到", "p": "v.", "parts": [["re", "re"], ["ceive", "cept"]], "x": "Did you receive my note?"},
  "reception": {"z": "接待；反响", "p": "n.", "parts": [["re", "re"], ["cept", "cept"], ["ion", "ion"]], "x": "The book had a warm reception."},
  "accept": {"z": "接受", "p": "v.", "parts": [["ac", "ad"], ["cept", "cept"]], "x": "They accepted the offer."},
  "acceptable": {"z": "可接受的", "p": "adj.", "parts": [["ac", "ad"], ["cept", "cept"], ["able", "able"]], "x": "The risk is acceptable."},
  "except": {"z": "除…之外", "p": "prep.", "parts": [["ex", "ex"], ["cept", "cept"]], "x": "Everyone came except Tom."},
  "deceive": {"z": "欺骗", "p": "v.", "parts": [["de", "de"], ["ceive", "cept"]], "x": "Appearances can deceive."},
  "inspect": {"z": "检查", "p": "v.", "parts": [["in", "in_into"], ["spect", "spect"]], "x": "Inspect the bridge before winter."},
  "respect": {"z": "尊重", "p": "v.", "parts": [["re", "re"], ["spect", "spect"]], "x": "Readers respect a careful argument."},
  "prospect": {"z": "前景", "p": "n.", "parts": [["pro", "pro"], ["spect", "spect"]], "x": "The prospect of a long essay scares some readers."},
  "formation": {"z": "形成", "p": "n.", "parts": [["form", "form"], ["ation", "ion"]], "x": "Habit formation takes time."},
  "reform": {"z": "改革", "p": "v.", "parts": [["re", "re"], ["form", "form"]], "x": "They want to reform the system."},
  "transform": {"z": "转变", "p": "v.", "parts": [["trans", "trans"], ["form", "form"]], "x": "Reading can transform how you think."},
  "inform": {"z": "通知", "p": "v.", "parts": [["in", "in_into"], ["form", "form"]], "x": "Please inform us of any change."},
  "conform": {"z": "遵从", "p": "v.", "parts": [["con", "con"], ["form", "form"]], "x": "Few essays conform to the template."},
  "produce": {"z": "生产", "p": "v.", "parts": [["pro", "pro"], ["duce", "duc"]]},
  "reduce": {"z": "减少", "p": "v.", "parts": [["re", "re"], ["duce", "duc"]], "x": "Short sessions reduce fatigue."},
  "conduct": {"z": "实施；行为", "p": "v.", "parts": [["con", "con"], ["duct", "duc"]], "x": "They conducted a small study."},
  "deduce": {"z": "推断", "p": "v.", "parts": [["de", "de"], ["duce", "duc"]], "x": "We can deduce the meaning from context."},
  "export": {"z": "出口", "p": "v.", "parts": [["ex", "ex"], ["port", "port"]], "x": "The region exports coffee."},
  "transport": {"z": "运输", "p": "v.", "parts": [["trans", "trans"], ["port", "port"]], "x": "Trains transport goods overnight."},
  "support": {"z": "支持", "p": "v.", "parts": [["sup", "sub"], ["port", "port"]], "x": "Data support the claim."},
  "transmit": {"z": "传输", "p": "v.", "parts": [["trans", "trans"], ["mit", "mit"]], "x": "Signals transmit instantly."},
  "submit": {"z": "提交", "p": "v.", "parts": [["sub", "sub"], ["mit", "mit"]], "x": "Submit the draft by noon."},
  "dismiss": {"z": "驳回，解散", "p": "v.", "parts": [["dis", "dis"], ["miss", "mit"]], "x": "Do not dismiss the idea too fast."},
  "mission": {"z": "使命", "p": "n.", "parts": [["miss", "mit"], ["ion", "ion"]], "x": "The magazine has a clear mission."},
  "construct": {"z": "建造", "p": "v.", "parts": [["con", "con"], ["struct", "struct"]], "x": "Construct a clear argument."},
  "instruct": {"z": "指导", "p": "v.", "parts": [["in", "in_into"], ["struct", "struct"]], "x": "She instructs new editors."},
  "destruction": {"z": "破坏", "p": "n.", "parts": [["de", "de"], ["struct", "struct"], ["ion", "ion"]], "x": "The storm caused wide destruction."},
  "predict": {"z": "预测", "p": "v.", "parts": [["pre", "pre"], ["dict", "dict"]], "x": "Few predicted the outcome."},
  "dictation": {"z": "听写", "p": "n.", "parts": [["dict", "dict"], ["ation", "ion"]], "x": "Dictation trains the ear."},
  "vision": {"z": "视野；愿景", "p": "n.", "parts": [["vis", "vis"], ["ion", "ion"]], "x": "The editor has a clear vision."},
  "visible": {"z": "可见的", "p": "adj.", "parts": [["vis", "vis"], ["ible", "ible"]], "x": "The change was barely visible."},
  "revise": {"z": "修订", "p": "v.", "parts": [["re", "re"], ["vise", "vis"]], "x": "Revise the draft once more."},
  "happiness": {"z": "幸福", "p": "n.", "parts": [["happi", "happy"], ["ness", "ness"]], "x": "Happiness is not the absence of effort."},
  "unhappy": {"z": "不快乐的", "p": "adj.", "parts": [["un", "un"], ["happy", "happy"]], "x": "He felt unhappy with the result."},
  "unhappiness": {"z": "不快乐", "p": "n.", "parts": [["un", "un"], ["happi", "happy"], ["ness", "ness"]], "x": "She felt a lingering unhappiness."},
  "attract": {"z": "吸引", "p": "v.", "parts": [["at", "ad"], ["tract", "tract"]], "x": "Long essays rarely attract casual readers."},
  "research": {"z": "研究", "p": "n.", "parts": [["re", "re"], ["search", "base", "search"]]},
  "attractive": {"z": "有吸引力的", "p": "adj.", "parts": [["at", "ad"], ["tract", "tract"], ["ive", "ive"]], "x": "The offer looked attractive."},
  "attraction": {"z": "吸引力", "p": "n.", "parts": [["at", "ad"], ["tract", "tract"], ["ion", "ion"]], "x": "The city has many attractions."},
  "distract": {"z": "使分心", "p": "v.", "parts": [["dis", "dis"], ["tract", "tract"]], "x": "Notifications distract us."},
  "distraction": {"z": "分心的事", "p": "n.", "parts": [["dis", "dis"], ["tract", "tract"], ["ion", "ion"]], "x": "The phone is a constant distraction."},
  "extract": {"z": "提取", "p": "v.", "parts": [["ex", "ex"], ["tract", "tract"]], "x": "Extract the key idea from each paragraph."},
  "contract": {"z": "合同；收缩", "p": "n.", "parts": [["con", "con"], ["tract", "tract"]], "x": "They signed a contract."},
  "subtract": {"z": "减去", "p": "v.", "parts": [["sub", "sub"], ["tract", "tract"]], "x": "Subtract the fees from the total."},
  "retract": {"z": "撤回", "p": "v.", "parts": [["re", "re"], ["tract", "tract"]], "x": "The paper retracted the claim."},
}

export const COMMON: string[] = ["like", "read", "write", "view", "do", "cover", "fair", "agree", "appear", "honest", "use", "care", "help", "hope", "power", "move", "place", "build", "play", "work", "act", "load", "order", "pay", "kind", "able", "happy", "lock", "tie", "wrap", "new", "fold", "pack", "test", "start", "turn", "view", "count", "form", "charge", "seen", "known", "done", "made", "said", "told", "taught", "sure", "clear", "true", "real", "usual", "equal", "legal", "moral", "social", "natural", "final", "normal", "person", "nation", "govern", "edit", "teach", "learn", "speak", "paint", "print", "lead", "think", "trust", "doubt", "fit", "friend", "child", "home", "hand", "mind", "heart", "word", "time", "light", "dark", "hard", "soft", "quick", "slow", "loud", "quiet", "calm", "bright", "care", "harm", "hope", "use", "fear"]


export const TYPE: Record<string, string> = {"pre": "前缀", "root": "词根", "suf": "后缀", "base": "词基"}
