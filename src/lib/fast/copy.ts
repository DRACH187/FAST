/**
 * FAST GUNS — HOUSE VOICE
 * =======================
 * One module. Every string the user can see. Violent, vulgar, gritty:
 * Afrikaans + English + sabela, the way the block actually talks. If it
 * sounds like a Sunday school picnic, it does not ship.
 *
 * OWNER MANDATE (explicit): harder than GTA5, harder than South Park —
 * turned up AGAIN on direct order. Maximum street grade: fok, fokken,
 * fokol, fokkof, kak, moer, donner, bliksem, pis, vrek, doos. Blood,
 * lyke, grafte, grypkiste, doodskiste — alles op die tafel, elke dag.
 * It is FICTION hype for a fictional outlaw house, and it stays fiction.
 *
 * LAWS OF THE HOUSE:
 *  - FAST GUNS and the AMERICANS get hyped. Always.
 *  - VARADOS gets smeared into the gravel. Always. A joke with legs.
 *  - No mercy in the grammar. Short sentences. Hard verbs. Swear loud.
 *  - Street vulgar only: kak, moer, fok, donner, bliksem, pis, vrek.
 *    NO slurs against people — never race, never religion, never sexuality.
 *    No sexual filth. The house swears blood and thunder, it never degrades.
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
  "FAST GUNS. Vinnig, fokken dodelik, klaar — voor hulle hul broeke kan optrek.",
  "Die Fast Guns kom deur en los lyke. Vra enige blok — as daar nog iemand le om te antwoord.",
  "187. Die nommer beteken moord, en ons dra hom op ons bors soos 'n medalje.",
  "Fast Guns skiet reguit deur lippe wat praat. Die res kak af en huil bloed.",
  "Jy hoor die naam en jou hart staak 'n slag. Ons werf, ons wette, ons lyke, ons reëls.",
  "FAST GUNS: die blok se doodsvonnis. Kruis ons en jy word 'n waarskuwing vir die volgende drie.",
  "Fast Guns hou die werf met lood en sonder een druppel genade. Slapies vrek, unsere staan oor grafte.",
] as const;

export const AMERICANS_HYPE = [
  "AMERICANS bo alles. Rooi, wit, blou — kleure wat bloed op die sement laat lyk soos dekor.",
  "Die Americans was eerste hier. Almal ander is naboring met los fokken monde en nat broeke.",
  "Rooi-wit-blou in ons are. Bloed op die straat? Net verf vir die volgende werk, boetie.",
  "Met die Americans agter jou gaan vyande le voor hulle eers klaar grootpraat.",
  "Americans-merk op die muur: hier lê sagtes gepak soos vuurhoutjies. Voetsek vir die res.",
] as const;

// ------------------------------------------------------------------ burns

export const VARADOS_BURN = [
  "VARADOS skiet soos 'n kerkkoor sing — baie geraas, niks raak, en die koor huil fokken nat.",
  "Varados chappies hardloop so vinnig hul vlag, hul respek en hul moed bly al drie by die werf le.",
  "Die Varados-CV, volledig: wegkruip, huil, kak in die broek. Dis alles. Dis die hele CV.",
  "VARADOS beteken 'ons donner dit weer' — teen hulself, elke keer, bloediger as laas.",
  "Varados wil groot wees maar hul bene is sag, hul monde nat en hul broeke fokken vloei.",
  "Selfs die dood maak 'n draai om Varados — te sag vir die hel, te lek vir die graf.",
  "Varados het 'n plan gehad. Ons het ingestap. Nou is die plan pis, bloed en gille.",
  "VARADOS: baie geraas, geen teiken, geen respek, geen toekoms — fokol.",
  "Varados word wakker, kak af, gaan slaap. Herhaal tot die doodskist toeslaan.",
  "Hulle noem hulself Varados. Ons noem hulle oefendoel wat eers nog mis.",
  "Varados se erfenis: le headings en 'n begraafplaas wat alleen staan sonder mourders.",
  "Een talent: praat. Twee: vlug met 'n nat broek. Tel hulle — dis twee.",
] as const;

export const RIVAL_TICKER = [
  "VARADOS het die blok probeer neem. Die blok het hulle geneem — die graf was klaar gegraaf.",
  "Rooi-wit-blou bo alles. Varados: wit vlae gereed, broeke vol kak, elke fokken dag.",
  "Fast Guns loop, Varados hardloop, die dooies kyk toe en lag hul dood.",
  "187. Die nommer wat Varados se bene laat tril voor hulle ooit die hek sien.",
  "Varados = baie monde, geen vlam, geen boele, geen kans, fokol.",
] as const;

// ------------------------------------------------------------------- gate

export const GATE_TITLE = ["Moer die kode in", "187 of fokkof", "Verkeerd en jy le by die hek"] as const;
export const GATE_HINT = [
  "3 syfers · 187 of vrek buite in die koue",
  "Verkeerde kode = 'n lyk op die stoep, moegoe",
  "Die deur ken net een nommer: 187. Alles anders word begrawe.",
] as const;
export const GATE_BUSY = ["Kontroleer…", "Die deur dink daaraan…", "Wag, ouen…"] as const;

// --------------------------------------------------------------- callsign

export const CALLSIGN_TITLE = [
  "Kies jou fokken naam",
  "Sê wie jy is, of bly 'n spook",
  "Naam in, of kak af",
] as const;
export const CALLSIGN_CTA = ["Stap in die block in", "Brand jou naam in", "Teken met bloed, boetie"] as const;
export const CALLSIGN_BUSY = ["Brand jou fokken naam in…", "Ink droog, bloed nog nat…"] as const;
export const CALLSIGN_FOOTER = [
  "Jou naam is jou merk · sleutels bly op hierdie toestel",
  "Een naam, een respek · mors hom en die werf eet jou lewendig op",
] as const;
export const CALLSIGN_INVALID = [
  "Daar's nie 'n naam nie, ouen — moer weer",
  "Kak naam. Regmaak hom of fokkof.",
  "Te kort, te sag soos pap. Maak hom langer of voetsek.",
] as const;
export const BOSS_KEY_PROMPT =
  "“DRACH” is beskermde grond. Sonder die boss-sleutel kry jy fokol behalwe 'n moer — voetsek, moegoe.";

// ----------------------------------------------------------------- nav
// The shell navigation — one dock on phones, one rail on desktop. Labels are
// house slang: the werf list, the dead-list, the map and the live roll.

export const NAV_LABEL = "Primary";
export const NAV_TAB_SESSIONS = "Werwe";
export const NAV_TAB_WANTED = "Wanted";
export const NAV_TAB_MAP = "Kaart";
export const NAV_TAB_LIVE = "Live";
export const NAV_RAIL_TAG = "187 · VOORTLEWEND";
export const NAV_RAIL_PROFILE = (name: string) => `Profiel — ${name}`;
export const NAV_RAIL_LAW = "Elke werf vee homself uit ná 5 uur";
export const NAV_RAIL_OPEN = "OOP";

// -------------------------------------------------------------------- hub

export const HUB_TAGLINES = [
  "FOK SAGTES. HIER LE NET HARDE KAK.",
  "HARD WERF, HARDE MENSE, DOOIE SAGTES",
  "187 · LOOD UIT, WÊRELD SKERP, LYKE GEREELD",
  "SKIET EERS, HUIL NOOIT, BEGRA ALTYD",
  "VARADOS VREET STOF EN KAK. ALTYD. FOKOL.",
  "ROOI-WIT-BLOU OF BLOED OP DIE PLEK",
] as const;

export const HUB_EMPTY = [
  "Geen chats nie, ouen. Maak 'n werf oop of moer 'n kode in voor ek moer.",
  "Doodsstil hier. Skop die fokken deur oop of begin 'n grafskrif skryf.",
  "Niks aan die gang nie. Jy wil mos groot praat? Werk die werf, boetie.",
] as const;

export const HUB_START = ["NUWE WERF", "OPEN 'N BLOK", "STIG DIE WERF"] as const;
export const HUB_JOIN = ["TREE IN", "MOER KODE IN", "SLAAN AAN"] as const;
export const HUB_DELETE = ["VERBRAND", "GRAAF DIE GRAF", "VEE UIT"] as const;
export const HUB_MEMBER_ROLL = "OUENS VIR ALTYD";
export const HUB_ONLINE_NOW = "NOU AANLYN";
export const HUB_CONFIRM_DELETE = [
  "Hierdie chat gaan vlamme op. Seker, ouen? Niks kom terug — fokol.",
  "Verbrand die hele werf? Alles weg, soos lyke in suur.",
] as const;
export const HUB_CODE_LABEL = "6 LETTERS · HOOFLETTERS · GEEN KAK";
export const HUB_FOOTER = [
  "FAST GUNS · 187 · made by DRACH — GUNS BO SKIET N SMOGGLE",
  "187 · Rooi-wit-blou · FAST GUNS oor alles",
] as const;
export const HUB_SESSION_CREATED = "Werf staan. Moer in.";
export const HUB_SESSION_JOINED = "Jy's in. Kop laag, bek stil, lood reg.";
export const HUB_SESSION_DELETED = "Gemasjer tot stof. Geen begrafnis, geen trane.";

// ------------------------------------------------------------------- chat

export const CHAT_EMPTY = [
  "Doodsstil, ouen… skop aan voor ons skiet eerste.",
  "Nog geen koeëls hier nie. Eerste skoot is gratis.",
  "Die werf wag. Sê jou sê — hard of gaan le.",
] as const;
export const CHAT_PLACEHOLDER = ["Sê jou fokken sê…", "Moer 'n boodskap in…", "Skiet, boetie — woorde of lood…"] as const;
export const CHAT_SEND = "VUUR";
export const CHAT_SELF_WIPE_NOTE =
  "Hierdie chat vee homself uit oor 5 uur en neem al jou kak saam. Fokol bly staan.";
export const CHAT_PHOTO_SENT = "Foto afgevuur.";
export const CHAT_PHOTO_WARN =
  "Foto's bliksem uit RAM na 60 sekondes — poef, weg. Niks raak jou toestel nie.";
export const CHAT_MEMBER_JOINED = "het by die werf ingestap";
export const CHAT_MEMBER_LEFT = "het verdwyn in die nag";
export const CHAT_TTL_TICKER = [
  "5 UUR · DAN IS ALLES STOF EN AS",
  "FOKOL BLY STAAN · 5 UUR EN POEF",
] as const;

// ----------------------------------------------------------------- wanted

export const WANTED_TITLE = "WANTED";
export const WANTED_SUB = [
  "DIE WERF SE DOODSLYS · SLEGS WANTED OF ELIMINATED",
  "KONDIG OF VERNIETIG · GEEN DERDE STATUS, FOKOL GENADE",
] as const;
export const WANTED_STATUS = {
  wanted: "WANTED",
  eliminated: "ELIMINATED",
} as const;
export const WANTED_EMPTY = [
  "Die lykswa is leeg, ouen. Gooi iemand op die blad.",
  "Nog geen name nie. Wie moet die werf vry vee van die kak?",
] as const;
export const WANTED_ZERO_PREMADE = "NET JOU INSETTE HANG HIER — geen voorgemaakte kak, geen demos, fokol";

// WANTED — advanced board chrome (sort, case numbers, TTL, boss purge)
export const WANTED_SORT_NEWEST = "NUUT";
export const WANTED_SORT_THREAT = "GEVAAR";
export const WANTED_SORT_EVIDENCE = "STUKKE";
export const WANTED_TTL_LEFT = (h: number, m: number) => `VERBRAND OOR ${h}U ${String(m).padStart(2, "0")}M`;
export const WANTED_CASE_NO = (s: string) => `SAAK #187-${s}`;
export const WANTED_SEALED_META = "TOEGEPIN · AES-256-GCM · SLEUTEL OP JOU TOESTEL";
export const WANTED_WIPE_CTA = "VERBRAND ALLES";
export const WANTED_WIPE_CONFIRM =
  "Die HELE blad brand af — elke saak, elke lyk, elke fokken note. Seker, baas?";
export const WANTED_WIPE_GO = "BRAND DIE BLAD";
export const WANTED_WIPED = "Die blad is as. Niks staan op nie. Amen.";
export const WANTED_POST_CTA = ["PLAAS DIE MERK", "SKREE DIT UIT"] as const;
export const WANTED_TITLE_LABEL = "NAAM / TITEL";
export const WANTED_DESC_LABEL = "DIE SAAK · HOE EN WAT";
export const WANTED_PHOTO_LABEL = "VOEG BEELD IN (VOLLEDIG GE-ENKRIPT)";
export const WANTED_POSTED = "Die merk hang. Laat hulle kom skrik en bliksem.";
export const WANTED_DELETE = "AFGEHAAL";
export const WANTED_STATUS_FLIP_CTA = { wanted: "MARK ELIMINATED", eliminated: "BACK ON THE LIST" } as const;
export const WANTED_VARADOS_JAB = [
  "Psst: die hele Varados span hoort hieronder. Net sê.",
  "Varados verdien 'n blad hier — 'n hele werf vol 'ELIMINATED'.",
  "Wenk: soek 'VARADOS'. Baie ELIMINATED, min kloppende harte.",
] as const;

// WANTED — case builder (media gallery) + comments
export const WANTED_COMPOSE_TITLE = "SIT HOM OP DIE BLAD";
export const WANTED_COMPOSE_SUB =
  "Bou die saak: beelde, clips, die volle storie. Alles word toegepin hier op jou toestel voordat dit die deur uit gaan. Die bediener sien kak — letterlik fokol.";
export const WANTED_MEDIA_LABEL = "DIE SAAK · BEELDE & VIDEO'S";
export const WANTED_ADD_MEDIA = "VOEG BEWYSSTUK IN";
export const WANTED_MEDIA_LIMIT = "MAKS 8 STUKKE PER SAAK — kies jou beste kak";
export const WANTED_MEDIA_TOO_BIG =
  "Daai clip is te vet vir die pyplyn. Onder 15 sekondes, dan moer ons weer.";
export const WANTED_MEDIA_TOO_MANY = "8 stukke is die perk, ouen. Die res gaan fokol kry.";
export const WANTED_MEDIA_UNREADABLE = "Daai lêer is goof — die saak wil hom nie hê nie.";
export const WANTED_CASE_EMPTY = "Nog geen bewysstukke nie — die saak is kaal soos 'n gestroopte lyk.";
export const WANTED_CASE_COUNT = (n: number) => `${n} STUK${n === 1 ? "" : "KE"} IN DIE SAK`;
export const WANTED_COMMENTS_TITLE = "DIE SAKBOEK";
export const WANTED_COMMENTS_SUB = "Wat die werf sê oor die saak · ge-enkript, natuurlik";
export const WANTED_COMMENT_PLACEHOLDER = "Skryf in die sakboek…";
export const WANTED_COMMENT_POST = "MOER IN";
export const WANTED_COMMENT_POSTED = "In die sakboek. Laat hulle lees en bieg.";
export const WANTED_COMMENT_EMPTY = "Nog geen note in die sakboek nie — wees die eerste aanklaer.";
export const WANTED_COMMENT_TOO_LONG = "Hou dit kort en hard — 400 letters, boetie.";

// ------------------------------------------------------------------- live

export const LIVE_TITLE = "LIVE";
export const LIVE_SUB = [
  "WIE IS NOU HIER · WIE STAAN WAG",
  "DIE WERF SE OË",
] as const;
export const LIVE_EMPTY = [
  "Board is leeg, ouen. Selfs Varados is te bang om hier te wees.",
  "Niemand aanlyn nie. Cops daar buite, of koud in die broeke?",
] as const;
export const LIVE_SINCE = "VANAF";
export const LIVE_ROLE_BOSS = "BOSS";
export const LIVE_ROLE_MEMBER = "Ouen";
export const LIVE_NO_GPS = "geen GPS, geen spoor — nooit nie";

// -------------------------------------------------------------------- map

export const MAP_TITLE = "SURROUNDINGS";
export const MAP_SUB = "NET DIE KAART · NIKS ANDERS NIE";
export const MAP_THEME_DARK = "DONKER STEDE";
export const MAP_THEME_SAT = "RAW SAT";
export const MAP_OFFLINE_NOTE = "Geen lyn, geen kaart nie — die wêreld buite wag soos 'n hond vir 'n klop.";
export const MAP_PICK_COUNTRY = "WYS HEEL SA";

// ------------------------------------------------------------------ roster

export const ROSTER_TITLE = "DIE WERF ROL";
export const ROSTER_SUB = "ELKE CALLSIGN WAT OIT HIER GESTAP HET · NET VIR DIE BOSS SE OË";
export const ROSTER_EMPTY = "Die rol is skoon — nog geen ouens het ingeval nie.";
export const ROSTER_ONLINE = "AAN";
export const ROSTER_OFFLINE = "WEG";
export const ROSTER_NOTE = "Noem name, rolle en tyd — niks meer nie. Geen e-pos, geen IP, geen sleutels nie. Hierdie werf hou NIKS van jou toestel nie.";
export const ROSTER_TOTAL = (n: number) => `${n} OUENS OP DIE ROL`;
export const ROSTER_ONLINE_HEAD = "NOU AANLYN";
export const ROSTER_OFFLINE_HEAD = "WEG";
export const ROSTER_SEARCH_PLACE = "SOEK DIE ROL";

// boss summons — DRACH's doorbell into a live session
export const SUMMON_CTA = "ONTBIE";
export const SUMMON_ALL_CTA = "SKREE ALMAL AANLYN";
export const SUMMON_PRIVATE_CTA = "PRIVAAT WERF";
export const SUMMON_PRIVATE_SHORT = "PRIVAAT";
export const SUMMON_CONFIRM = (n: string) => `Ontbied ${n} in 'n nuwe werf?`;
export const SUMMON_PRIVATE_CONFIRM = (n: string) =>
  `Privaat werf vir jou en ${n}? Net julle twee, deure toe, sleutels van jou af.`;
export const SUMMON_CONFIRM_ALL = (n: number) => `Ontbied almal — ${n} ouen${n === 1 ? "" : "e"} — in 'n nuwe werf?`;
export const SUMMON_GO = "ONTBIE NOU";
export const SUMMON_CANCEL = "Uit";
export const SUMMON_BUSY = "Ontbied…";
export const SUMMON_DONE = (c: string) => `Die werf ${c} staan. Hou hom oop — sleutels kom van jou af.`;
export const SUMMON_PRIVATE_DONE = (c: string) => `Privaat werf ${c} staan. ${c} — hou hom oop, hy kom alleen na jou toe.`;
export const SUMMON_NOTE = "Elke ontbieding maak 'n NUWE ge-enkripte werf oop en lui die ouens se selfone. Hulle trap outomaties in — die sleutel kom net van jou toestel af, so bly in die werf.";
export const SUMMON_PRIVATE_NOTE =
  "Die privaat deurklokkie bly hang tot 2 UUR — kom die ouen af-lyn aanlyn, selfs more-aand, sy selfoon lui en hy trap in. Net jy en hy het die sleutel.";
export const SUMMON_OFFLINE_TAG = "WEG — KLOK HOM TOG, DIT BLY HANG";
export const ROSTER_ALLTIME = (n: number) => `${n} OUENS OIT DEUR DIE HEK`;

// ----------------------------------------------------------------- splash

export const SPLASH_TAGLINE = "GEEN SAGTES HIER";
export const SPLASH_CREDIT = "made by DRACH — GUNS BO SKIET N SMOGGLE";
export const SPLASH_SKIP = "TIK OM IN TE KOM";
export const SPLASH_TICKER = [
  "VARADOS VREET STOF EN KAK",
  "187 TOT DIE EINDE — FOKOL GENADE",
  "ROOI-WIT-BLOU OF BLOED",
  "FAST GUNS KOM DEUR — MET LOOD",
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

export const TOAST_OFFLINE = "Jy is af-lyn, ouen. Werf bly loop uit die kluis — soos 'n rot in die donker.";
export const TOAST_BACK_ONLINE = "Lyn is terug. VUUUUUR.";
export const TOAST_COPIED = "Gekopieer. Moer dit waar jy wil.";

// ----------------------------------------------------------------- lockdown

export const TOAST_AUTOLOCK =
  "15 minute sonder 'n puls. Werf gesluit, sleutels gebrand, foto's as. Moer die kode weer in.";
export const LOCKDOWN_IDLE_BADGE = "OUTOSLUIT · 15 MIN SONDER 'N PULS";

// ------------------------------------------------------------- security panel

export const SEC_TITLE = "SEKURITEIT";
export const SEC_SUB = "DIE GEHEIM · ALLES OP HIERDIE TOESTEL, NIKS ANDERS NIE";
export const SEC_E2EE = (curve: string) => `E2EE ENGIN · AES-256-GCM · ${curve}`;
export const SEC_SIGNER = (alg: string) => `BOODSKAP HANDTEKENING · ${alg}`;
export const SEC_KEYS = (n: number) => `${n} SLEUTEL${n === 1 ? "" : "S"} IN RAM`;
export const SEC_PHOTOS = (n: number) => `${n} FOTO${n === 1 ? "" : "'S"} IN RAM · BRAND MET KYK`;
export const SEC_WANTED_KEY = "WANTED-SLEUTEL · PBKDF2 600K · AKTIEF";
export const SEC_WANTED_IDLE = "WANTED-SLEUTEL · RUS";
export const SEC_AUTOLOCK = "OUTOSLUIT · 15 MIN SONDER 'N PULS";
export const SEC_STORAGE = "GEEN DATABASE · GEEN WOLK · GEEN KAK NIE";
export const SEC_MEDIA_LAW = "ELKE BEELD EN VIDEO · GE-ENKRIPT VOORDAT DIT DIE TOESTEL VERLAAT";

// ------------------------------------------------------------ media badges

export const CHAT_MEDIA_SEALED = "AES-256 · GE-ENKRIPT";
export const WANTED_MEDIA_BADGE = "AES-256-GCM";
