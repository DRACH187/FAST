/**
 * FAST GUNS — HOUSE VOICE
 * =======================
 * One module. Every string the user can see. Violent, vulgar, gritty:
 * Afrikaans + English + sabela, the way the block actually talks. If it
 * sounds like a Sunday school picnic, it does not ship.
 *
 * LAWS OF THE HOUSE:
 *  - FAST GUNS and the AMERICANS get hyped. Always.
 *  - VARADOS and the BRITISH get smeared. Always. They are jokes with legs.
 *  - No mercy in the grammar. Short sentences. Hard verbs.
 *  - Vulgar means street vulgar: kak, moer, donner, bliksem, voetsek, pis.
 *    No slurs against people. No sexual filth. The house swears, it never degrades.
 *  - Editing copy = editing THIS file. Nothing else. (Maintainability law.)
 */

// ------------------------------------------------------------------ utils

/** Random pick — fresh every call, so screens feel alive. */
export function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

/** Pick without immediately repeating (per-screen flavour rotation). */
export function pickDiff<T>(list: readonly T[], last: T | null): T {
  if (list.length < 2) return list[0];
  let choice = pick(list);
  let guard = 0;
  while (choice === last && guard < 6) {
    choice = pick(list);
    guard += 1;
  }
  return choice;
}

// ------------------------------------------------------------- brand hype

export const HOUSE = "FAST GUNS";
export const HOUSE_MARK = "187";
export const ALLY = "AMERICANS";

export const FAST_HYPE = [
  "FAST GUNS. Vinnig, skerp, klaar — voor hulle gaan staan het.",
  "Die Fast Guns kom deur — altyd. Vra enige blok.",
  "187 tot die einde. Fast Guns tot die dood.",
  "Fast Guns skiet reguit. Die res van die strate skiet krom en huil later.",
  "Jy hoor die naam, jy weet wie die werf hou. Altyd ons eie.",
  "FAST GUNS: die blok se baslyn, die straat se wet.",
  "Fast Guns hou die werf. Slapies loop, unsere bly staan.",
] as const;

export const AMERICANS_HYPE = [
  "AMERICANS bo alles. Rooi, wit, blou — die hemel se eie kleure.",
  "Die Americans was eerste hier. Almal ander is naboring met los mond.",
  "Rooi-wit-blou loop deur ons are. Americans tot ons laaste asem.",
  "Met die Americans agter jou hardloop niemand jou aan nie — hulle loop eerder self.",
  "Americans-merk op die muur beteken: hier regeer ordlike mense, voetsek vir die res.",
] as const;

// ------------------------------------------------------------------ burns

export const VARADOS_BURN = [
  "VARADOS? Hulle skiet soos 'n kerkkoor sing — baie geraas, niks raak nie.",
  "Varados chappies hardloop so vinnig hul vlags bly nog by die werf le.",
  "Die Varados se grootste talente: wegkruipertjie en huil in die hoek.",
  "VARADOS beteken in hul taal: 'ons donner dit weer' — en hulle doen. Elke keer teen hulself.",
  "Varados wil 'n groot span wees maar hulle asem te hard en hul bene te sag.",
  "Selfs die British lag vir Varados. As jou vyand jou uitlag, boetie, dis klaar.",
  "Varados het 'n plan gehad. Toe stap ons in en die plan het pis en loop.",
  "VARADOS: baie geraas, geen kolle op die teiken, geen respek op die straat.",
  "Varados word wakker, verloor die dag, gaan slaap. Herhaal tot hul dood.",
  "Hulle noem hulself Varados. Ons noem hulle oefendoel — en selfs daar mis hulle.",
  "Varados se erfenis: 'n klomp le headings en niks gewenste oorde nie.",
  "Varados het een talen: praat. Twee as jy tel hoe vinnig hulle vlug.",
] as const;

export const BRITISH_BURN = [
  "Die BRITISH praat groot Engels en bly klein oorsee in hul hartjie.",
  "British boytjies dra union jacks en geen balle nie — net tee en tande.",
  "Die British storm soos tee-time — te laat, te stadig, te sag om hier te survive.",
  "Brits het beloof om terug te kom. Ons wag nog, boetie. Ons wag nog.",
  "Die British se plan B is om plan A te huil en dan huistoe te hardloop.",
  "Tee-drinkers met jalouse. BRITISH is 'n grap, nie 'n bedreiging nie.",
  "British kom die blok in soos toeriste — en vertrek soos toeriste wat gebliksem is.",
] as const;

export const RIVAL_TICKER = [
  "VARADOS het die blok probeer neem. Die blok het hulle geneem — vir 'n grap.",
  "BRITISH sê hulle kom oorsee. Goed — meer tyd vir ons om te oefen.",
  "Rooi-wit-blou bo alles. Varados en British: wit vlae altyd gereed.",
  "Fast Guns loop, Varados hardloop, British gly op hul eie moed.",
  "187. Die nommer wat Varados laat slaap met die lig aan en die deur gesperr.",
  "Varados + British = baie monde, geen vlam. Elke keer dieselfde storie.",
] as const;

// ------------------------------------------------------------------- gate

export const GATE_TITLE = ["Moer die kode in", "187 of voetsek", "Klop aan, boetie"] as const;
export const GATE_HINT = [
  "3 syfers · 187 of voetsek",
  "Verkeerde kode = bly buite, moegoe",
  "Die deur ken net een nommer: 187",
] as const;
export const GATE_BUSY = ["Kontroleer…", "Die deur dink daaraan…", "Wag, ouen…"] as const;

// --------------------------------------------------------------- callsign

export const CALLSIGN_TITLE = [
  "Kies jou naam, ouen",
  "Sê wie jy is, of bly 'n spook",
  "Naam in, respekteer die werf",
] as const;
export const CALLSIGN_CTA = ["Stap in die block in", "Brand jou naam in", "Teken die werf"] as const;
export const CALLSIGN_BUSY = ["Brand jou naam in…", "Ink droog…"] as const;
export const CALLSIGN_FOOTER = [
  "Jou naam is jou merk · sleutels bly op hierdie toestel",
  "Een naam, een respek · moenie jou naam mors nie",
] as const;
export const CALLSIGN_INVALID = [
  "Daar's nie 'n naam nie, ouen — probeer weer",
  "Kak naam. Regmaak hom.",
  "Te kort, te sag. Maak hom langer of voetsek.",
] as const;
export const BOSS_KEY_PROMPT =
  "“DRACH” is beskermde grond. Sonder die boss-sleutel kry jy niks — voetsek, moegoe.";

// -------------------------------------------------------------------- hub

export const HUB_TAGLINES = [
  "GEEN SAGTES HIER",
  "HARD WERF, HARDE MENSE",
  "187 · WAPENS UIT, WERELD SKERP",
  "SKIET EERS, HUIL NOOIT",
  "VARADOS VREET STOF. BRITISH OOK.",
  "ROOI-WIT-BLOU OF NIKS",
] as const;

export const HUB_EMPTY = [
  "Geen chats nie, ouen. Maak 'n werf oop of moer 'n kode in.",
  "Doodsstil hier. Skop die deur oop — stig 'n sessie.",
  "Niks aan die gang nie. Jy wil mos groot praat? Werk die werf.",
] as const;

export const HUB_START = ["NUWE WERF", "OPEN 'N BLOK", "STIG DIE WERF"] as const;
export const HUB_JOIN = ["TREE IN", "MOER KODE IN", "SLAAN AAN"] as const;
export const HUB_DELETE = ["VERBRAND", "MOER DIE HUIS OOP", "VEE UIT"] as const;
export const HUB_MEMBER_ROLL = "OUENS VIR ALTYD";
export const HUB_ONLINE_NOW = "NOU AANLYN";
export const HUB_CONFIRM_DELETE = [
  "Hierdie chat gaan vlamme op. Seker, ouen?",
  "Verbrand die hele werf? Alles weg, vir altyd?",
] as const;
export const HUB_CODE_LABEL = "6 LETTERS · HOOFLETTERS · GEEN KAK";
export const HUB_FOOTER = [
  "FAST GUNS · 187 · made by DRACH — GUNS BO SKIET N SMOGGLE",
  "187 · Rooi-wit-blou · FAST GUNS oor alles",
] as const;
export const HUB_SESSION_CREATED = "Werf staan. Moer in.";
export const HUB_SESSION_JOINED = "Jy's in. Hou jou kop regs.";
export const HUB_SESSION_DELETED = "Gemasjer tot stof.";

// ------------------------------------------------------------------- chat

export const CHAT_EMPTY = [
  "Doodsstil, ouen… skop die ding aan.",
  "Nog geen koeëls hier nie. Skiet die eerste skoot.",
  "Die werf wag. Sê jou sê — hard.",
] as const;
export const CHAT_PLACEHOLDER = ["Sê jou sê…", "Moer 'n boodskap in…", "Skiet, boetie…"] as const;
export const CHAT_SEND = "VUUR";
export const CHAT_SELF_WIPE_NOTE = "Hierdie chat vee homself uit oor 5 uur. Niks bly staan nie.";
export const CHAT_PHOTO_SENT = "Foto afgevuur.";
export const CHAT_PHOTO_WARN =
  "Foto's bliksem uit RAM na 60 sekondes. Niks raak jou toestel nie.";
export const CHAT_MEMBER_JOINED = "het by die werf ingestap";
export const CHAT_MEMBER_LEFT = "het verdwyn in die nag";
export const CHAT_TTL_TICKER = [
  "5 UUR · DAN IS ALLES STOF",
  "NIKS BLY STAAN NIE · 5 UUR",
] as const;

// ----------------------------------------------------------------- wanted

export const WANTED_TITLE = "WANTED";
export const WANTED_SUB = [
  "DIE WERF SE DOODSLYS · SLEGS WANTED OF ELIMINATED",
  "KONDIG OF VERNIETIG · GEEN DERDE STATUS NIE",
] as const;
export const WANTED_STATUS = {
  wanted: "WANTED",
  eliminated: "ELIMINATED",
} as const;
export const WANTED_EMPTY = [
  "Die lykswa is leeg, ouen. Sit iemand op die blad.",
  "Nog geen name nie. Wie moet die werf vry vee?",
] as const;
export const WANTED_POST_CTA = ["PLAAS DIE MERK", "SKREE DIT UIT"] as const;
export const WANTED_TITLE_LABEL = "NAAM / TITEL";
export const WANTED_DESC_LABEL = "DIE SAAK · HOE EN WAT";
export const WANTED_PHOTO_LABEL = "VOEG BEELD IN (VOLLEDIG GE-ENKRIPT)";
export const WANTED_POSTED = "Die merk hang. Laat hulle kom kyk.";
export const WANTED_DELETE = "AFGEHAAL";
export const WANTED_STATUS_FLIP_CTA = { wanted: "MARK ELIMINATED", eliminated: "BACK ON THE LIST" } as const;
export const WANTED_VARADOS_JAB = [
  "Psst: die hele Varados span hoort hieronder. Net sê.",
  "Varados verdien 'n blad hier — 'n hele werf vol 'ELIMINATED'.",
  "Wenk: soek 'VARADOS'. Jy gaan baie ELIMINATED sien.",
] as const;

// WANTED — case builder (media gallery) + comments
export const WANTED_COMPOSE_TITLE = "SIT HOM OP DIE BLAD";
export const WANTED_COMPOSE_SUB =
  "Bou die saak: beelde, clips, die volle storie. Alles word toegepin hier op jou toestel voordat dit die deur uit gaan. Die bediener sien kak — letterlik.";
export const WANTED_MEDIA_LABEL = "DIE SAAK · BEELDE & VIDEO'S";
export const WANTED_ADD_MEDIA = "VOEG BEWYSSTUK IN";
export const WANTED_MEDIA_LIMIT = "MAKS 8 STUKKE PER SAAK — kies jou beste kak";
export const WANTED_MEDIA_TOO_BIG =
  "Daai clip is te vet vir die pyplyn. Hou videos onder 15 sekondes en probeer weer.";
export const WANTED_MEDIA_TOO_MANY = "8 stukke is die perk, ouen. Die res gaan nie deur nie.";
export const WANTED_MEDIA_UNREADABLE = "Daai lêer is goof — die saak wil hom nie hê nie.";
export const WANTED_CASE_EMPTY = "Nog geen bewysstukke nie — die saak is kaal.";
export const WANTED_CASE_COUNT = (n: number) => `${n} STUK${n === 1 ? "" : "KE"} IN DIE SAK`;
export const WANTED_COMMENTS_TITLE = "DIE SAKBOEK";
export const WANTED_COMMENTS_SUB = "Wat die werf sê oor die saak · ge-enkript, natuurlik";
export const WANTED_COMMENT_PLACEHOLDER = "Skryf in die sakboek…";
export const WANTED_COMMENT_POST = "MOER IN";
export const WANTED_COMMENT_POSTED = "In die sakboek. Laat hulle lees.";
export const WANTED_COMMENT_EMPTY = "Nog geen note in die sakboek nie — wees die eerste.";
export const WANTED_COMMENT_TOO_LONG = "Hou dit kort en hard — 400 letters.";

// ------------------------------------------------------------------- live

export const LIVE_TITLE = "LIVE";
export const LIVE_SUB = [
  "WIE IS NOU HIER · WIE STAAN WAG",
  "DIE WERF SE OË",
] as const;
export const LIVE_EMPTY = [
  "Board is leeg, ouen. Selfs Varados is hier vir een keer.",
  "Niemand aanlyn. Te veel cops daar buite?",
] as const;
export const LIVE_SINCE = "VANAF";
export const LIVE_ROLE_BOSS = "BOSS";
export const LIVE_ROLE_MEMBER = "Ouen";
export const LIVE_NO_GPS = "geen GPS, geen spoor — nooit nie";

// -------------------------------------------------------------------- map

export const MAP_TITLE = "SURROUNDINGS";
export const MAP_SUB = [
  "SUID-AFRIKA · WIE LOOP WAT · BLOK VIR BLOK",
  "DIE WERF KAART · HOTSPOTS EN TURF",
] as const;
export const MAP_REFRESH_NOTE = "VERSEND ELKE 10 MIN · KRY DIE LASTE INTEL";
export const MAP_LEGEND_HOME = "FAST GUNS GROND";
export const MAP_LEGEND_ALLY = "AMERICANS GROND";
export const MAP_LEGEND_RIVAL = "VYAND TURF";
export const MAP_TURF_NOTE = [
  "Rooi-wit-blou oor die Flats. Die kaart liegt nie.",
  "Elke blok het 'n baas. Meeste van hulle is ons.",
] as const;
export const MAP_VARADOS_JAB = [
  "VARADOS se turf lyk soos 'n verlate grond — hulle kan nie eens reg uitkom nie.",
  "Waar VARADOS loop, huil die straat. Van skande.",
  "Die BRITISH se blokke is so hul gevaar: op die kaart verdwyn hulle.",
  "Varados beteken 'val'. Hulle leef hul naam. Elke dag.",
] as const;
export const MAP_INTENSITY = { 1: "STIL", 2: "WARM", 3: "WARM", 4: "HOT", 5: "OORLOG" } as const;
export const MAP_ANALYTICS_TITLE = "OORLOG ANALITIEK";
export const MAP_SOURCE_GEMINI = "AI INTEL · GEMINI";
export const MAP_SOURCE_FALLBACK = "HUIS INTEL · AF-LYN";
export const MAP_THEME_DARK = "DONKER STEDE";
export const MAP_THEME_SAT = "RAW SAT";
export const MAP_TAP_AREA = "TIK 'N GEBIED · DIE KAART VOLG";
export const MAP_OFFLINE_NOTE = "Geen lyn, geen kaart nie — die wêreld buite wag.";
export const MAP_PICK_COUNTRY = "WYS HEEL SA";

// --------------------------------------------------------------------- AI

export const AI_TITLE = "WAR ROOM";
export const AI_SUB = [
  "VRA DIE BOETIE · DIE WERF SE EIE ORAKEL",
  "DIE BOETIE ANTWOORD · SABELA REËLS",
] as const;
export const AI_PLACEHOLDER = ["Vra die Boetie…", "Skiet jou vraag…"] as const;
export const AI_GREETING = [
  "Mooi loop, ouen. Die Boetie staan wakker. Wat wil jy weet?",
  "Ja boetie, die Boetie is hier. Vra — maar moenie sag vra nie.",
] as const;
export const AI_QUICK_CHIPS = [
  "Roast VARADOS",
  "Roast die BRITISH",
  "Hoekom is FAST GUNS die beste?",
  "Sê iets oor die Americans",
  "Verduidelik sabela vir 'n nuwe ou",
] as const;
export const AI_NO_KEY = [
  "Die AI is doeas — daar's geen GEMINI_API_KEY nie. Boss moet 'n gratis AIza…-sleutel in Vercel gooi, dan word hierdie ding lewendig.",
  "Geen sleutel, geen Boetie. Sit GEMINI_API_KEY in Vercel (gratis AIza…-sleutel van Google AI Studio) en probeer weer.",
] as const;
export const AI_FAILED = [
  "Die Boetie se lyn is dood. Probeer weer, ouen.",
  "Gemini het kak. Probeer weer.",
] as const;
export const AI_BLOCKED = [
  "Die Boetie swyg oor daai een — sy leierskap is te sag vir die vraag. Vra iets anders.",
  "Nee, daai vraag het by die verkeerde ou geland. Skop weer, ander rigting.",
] as const;
export const AI_THINKING = ["Die Boetie dink…", "Hy skarrel…", "Wag, hy sny net sy gebraai…"] as const;

// ----------------------------------------------------------------- splash

export const SPLASH_TAGLINE = "GEEN SAGTES HIER";
export const SPLASH_CREDIT = "made by DRACH — GUNS BO SKIET N SMOGGLE";
export const SPLASH_SKIP = "TIK OM IN TE KOM";
export const SPLASH_TICKER = [
  "VARADOS VREET STOF",
  "BRITISH BLY OORSEE",
  "187 TOT DIE EINDE",
  "ROOI-WIT-BLOU BO ALLES",
  "FAST GUNS KOM DEUR",
] as const;

// ---------------------------------------------------------------- profile

export const PROFILE_TITLE = "JOU MERK";
export const PROFILE_SAVE = ["HOU DIE NAAM", "MERK HOM VAST"] as const;
export const PROFILE_DELETE = ["VEE DIE NAAM UIT", "AS DIE NAAM MOET STERF"] as const;
export const PROFILE_SAVED = "Naam gebrand in die muur.";
export const PROFILE_DELETED = "Naam as stof.";
export const PROFILE_INSTALL = "HIERDIE DING OP JOU SEL";
export const PROFILE_ROLL_LABEL = "ALL-TIME ROL";
export const PROFILE_FOOTER = [
  "FAST GUNS · 187 · GEEN DATABASES · GEEN SAKE NIE",
  "ALLES IN RAM · ALLES WEG MET TYD",
] as const;

// ----------------------------------------------------------------- toasts

export const TOAST_OFFLINE = "Jy is af-lyn, ouen. Werf bly loop uit die kluis.";
export const TOAST_BACK_ONLINE = "Lyn is terug. Vuur aan.";
export const TOAST_COPIED = "Gekopieer. Moer dit waar jy wil.";
