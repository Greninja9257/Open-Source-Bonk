'use strict';
// The cursing filter, as the original does it: find a word from its list and replace that
// word -- not the whole message, not a row of asterisks -- with the literal text "bonk".
// A message can contain several, and each one is replaced.
//
// Read out of the live client: game.wab is the word list, game.charReplacements is the
// normalisation table, game.profanityCheck finds the first listed word in a lowercased and
// normalised copy, and game.censorString splices "bonk" over it by index. Because every
// replacement below is one character for one character, those indices line up with the
// original text, which is why splicing by index is safe.
//
// ONE DELIBERATE DIFFERENCE from the original, recorded in comparisons/lobby-evidence.md:
// the original normalises with `new RegExp(char, "g")`, so its "$" -> "s" entry does not
// work -- "$" is end-of-string in a regex, and the original ends up appending an "s"
// instead of replacing the "$". This build replaces "$" literally, which is plainly what
// the table intends. Everything else matches.
(root => {
  // game.charReplacements
  const REPLACEMENTS = [
    ["@", "a"], ["0", "o"], ["1", "i"], ["2", "r"],
    ["3", "e"], ["4", "a"], ["5", "s"], ["7", "t"],
    ["8", "b"], ["9", "g"], ["ä", "a"], ["ã", "a"],
    ["â", "a"], ["ä", "a"], ["á", "a"], ["à", "a"],
    ["å", "a"], ["é", "e"], ["è", "e"], ["ë", "e"],
    ["ê", "e"], ["§", "s"], ["$", "s"], ["£", "l"],
    ["€", "e"], ["ü", "u"], ["û", "u"], ["ú", "u"],
    ["ù", "u"], ["î", "i"], ["ï", "i"], ["í", "i"],
    ["ì", "i"], ["ÿ", "y"], ["ý", "y"], ["ö", "o"],
    ["ô", "o"], ["õ", "o"], ["ó", "o"], ["ò", "o"]
  ];
  // game.wab
  const WORDS = [
    "nigger", "nigga", "cunt", "coon", "fag", "faggot",
    "rape", "negro", "nig nog", "nignog", "asshole", "homo",
    "bastard", "slut", "cock", "fuck", "bitch", "pussy",
    "whore", "shit", "anus", "bollocks", "ballsack", "ball sack",
    "suck my", "tits", "clit", "dick", "fecal", "feltch",
    "masturbate", "wank", "pedo", "paedo", "pedofile", "pedophile",
    "paedophile", "paedofile", "pegging", "penis", "piss", "poof",
    "quim", "rectum", "scat", "jizz", "spunk", "sperm",
    "schlong", "shlong", "shemale", "smut", "splooge", "strapon",
    "strap on", "dildo", "tosser", "tushy", "twat", "vagina",
    "wank", "white power", "씨발", "ㅆㅂ", "개새", "십새",
    "섹스", "개자식", "미친새끼", "미친년", "뻑큐", "뻐큐",
    "쌍년", "쌍놈", "쌍넘", "쉑", "지랄", "창녀",
    "지럴", "좁밥", "좆", "좃까", "섹", "병신",
    "부랄", "ㅄ", "ㅂㅅ", "ㅈㄹ", "ㄳㄲ", "ㄱㅅㄲ",
    "불알", "븅", "새꺄", "새갸"
  ];

  const normalise = text => {
    let out = String(text).toLowerCase();
    for (const [from, to] of REPLACEMENTS) out = out.split(from).join(to);
    return out;
  };

  // game.profanityCheck: the first listed word present, in the list's own order.
  const check = text => {
    const hay = normalise(text);
    for (const word of WORDS) {
      const at = hay.indexOf(word);
      if (at !== -1) return { found: true, word, from: at, to: at + word.length };
    }
    return { found: false };
  };

  // game.sanitizeString: keep censoring until nothing is left to find. "bonk" contains no
  // listed word, so this always terminates.
  const sanitize = text => {
    let out = String(text);
    for (;;) {
      const hit = check(out);
      if (!hit.found) return out;
      out = out.slice(0, hit.from) + 'bonk' + out.slice(hit.to);
    }
  };

  // Whether the viewer has "Filter cursing" on. The original keeps this in its own
  // controls; this build keeps it in the settings blob, defaulting to on.
  const enabled = () => {
    try {
      return JSON.parse(localStorage.getItem('bonkSettings') || '{}').filterProfanity !== false;
    } catch (error) {
      return true;
    }
  };
  // What a chat line should display: the original filters on receipt, per viewer, so the
  // setting only changes what you see and never what anyone else sent.
  const filtered = text => (enabled() ? sanitize(text) : String(text));

  const api = { sanitize, check, filtered, enabled, WORDS, REPLACEMENTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BonkProfanity = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
