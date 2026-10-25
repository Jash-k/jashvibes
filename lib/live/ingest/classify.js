// Tamil-catalogue classification rules: pocket allow/block lists, language,
// sports and popularity heuristics. Split from the former lib/liveTv.js god
// module (phase 1) — behaviour unchanged.

import { normalizeWhitespace } from './text.js';
import { isPocketSource } from './registry.js';

function pocketKey(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const POCKET_WANTED_NAMES = new Set(`
ktv hd
zee thirai hd
vijay super hd
vijay takkar
j movies
raj digital plus
star movies hd
star movies select hd
tata play hollywood local
star vijay hd
zee tamil hd
colors tamil hd
d tamil
sun tv hd
kalaignar tv
jaya tv hd
vendhar tv
sirippoli
chithiram
sun tv hd au
sun tv hdr10
sun life
adithya tv
chutti tv
astro vinmeen
thangathirai
vasantham
astro vaanavil
astro vellithirai
star vijay
sun tv
colors tamil
zee tamil
ktv
adithya
zee thirai
sony yay
sony yay!
eye tamil
eye tamil comedy
roja tv
roja movies hd
vaanam tv
utv
suriya tv
suriyan tv
rock tv
tamil ratna
magalir tv
namma gobi tv
om sakthi tv
velavan tv
vinayaga tv
isai tv
jayam tv
devi tv
jith tv
alar tv
malar tv
malar tv alangulam
alangulam sky tv
king tv alangulam
chola tv
raga tv
ragam tv
3 star tv
oli tv
sri arjun tv
fort tv
aramm tv
sai tv
sai tv tenkasi
sabari tv aruppukottai
shark tv
gjv tv
naveen tv
apple tv puducherry
diamond tv
diamond talkies
pdp tv
arun tv
selfie tv
velan tv
naga tv
acp tv
acp classic
aps tv gold
aps gold tv
chither tv
mcn
s media
subin tv
subintv
silver sat media
thalaa tv
thala tv
sun news
tamil janam
raj news 24x7
jaya plus
news18 tamil nadu
news tamil 24x7
news j
thanthi tv
polimer news
news7 tamil
puthiya thalaimurai
seithigal tv
sathiyam tv
malaimurasu seithigal
malai murasu seithigal
star sports 1 tamil
star sports 1 tamil hd
star sports 2 tamil
star sports 2 tamil hd
sony sports ten 4 tamil
sony ten 4 tamil
`.split('\n').map(pocketKey).filter(Boolean));

function parsePocketNameList(value = '') {
  return String(value || '')
    .split(/[\n,|;]+/)
    .map(pocketKey)
    .filter(Boolean);
}

const POCKET_DEFAULT_REMOVED_NAMES = parsePocketNameList(`
9xjalwa
9xm
chither isai
mega musiq
aadvik tv
diamond music
eye tamil music
hit songs
latest songs
max music
mix songs
mn music
romantic songs
sachin music
thalapathy tv
trending songs
tsnmusic
zoom
yet music
`);

const POCKET_REMOVED_NAMES = new Set([
  ...POCKET_DEFAULT_REMOVED_NAMES,
  ...parsePocketNameList(process.env.POCKET_REMOVE_CHANNELS),
  ...parsePocketNameList(process.env.POCKET_HIDE_CHANNELS),
  ...parsePocketNameList(process.env.LIVE_POCKET_REMOVE_CHANNELS),
  ...parsePocketNameList(process.env.LIVE_POCKET_HIDE_CHANNELS),
]);

function pocketCompactKey(value = '') {
  return pocketKey(value).replace(/\s+/g, '');
}

function isPocketRemovedChannel(channel = {}) {
  const name = pocketKey(channel.name);
  const compactName = pocketCompactKey(channel.name);
  if (!name) return false;
  if (POCKET_REMOVED_NAMES.has(name)) return true;
  return [...POCKET_REMOVED_NAMES].some((removed) => pocketCompactKey(removed) === compactName);
}

function isPocketWantedChannel(channel = {}) {
  if (hasBlockedLiveCategory(channel) || isPocketRemovedChannel(channel)) return false;
  const name = pocketKey(channel.name);
  const category = pocketKey(channel.category);

  if (!name) return false;
  if (category === 'music') return true;
  if (POCKET_WANTED_NAMES.has(name)) return true;
  if (name.includes('alangulam') && name.includes('tv')) return true;
  if (name.includes('thalaa') && name.includes('tv')) return true;

  if (category === 'news') {
    return (
      name.includes('tamil') ||
      name.includes('thanthi') ||
      name.includes('polimer') ||
      name.includes('puthiya') ||
      name.includes('sathiyam') ||
      name.includes('malaimurasu') ||
      name.includes('malai murasu') ||
      name.includes('jaya plus') ||
      name.includes('news j') ||
      name.includes('sun news') ||
      name.includes('tamil janam') ||
      name.includes('raj news') ||
      name.includes('seithigal')
    );
  }

  if (category === 'sports' || name.includes('sports')) {
    return name.includes('tamil') || name.includes('ten 4');
  }

  return false;
}

const POPULAR_TAMIL_RULES = [
  'star vijay hd',
  'star vijay',
  'sun tv hd',
  'sun tv',
  'zee tamil hd',
  'zee tamil',
  'ktv hd',
  'ktv',
  'vijay super hd',
  'vijay super',
  'vijay takkar',
  'sun music hd',
  'sun music',
  'jaya max',
  'jayamax',
  'raj musix',
  'raj music',
  'isaiaruvi',
  '7s music',
  'mega musiq',
  'murasu',
  'adithya tv',
  'jaya tv hd',
  'jaya tv',
  'kalaignar tv',
  'raj tv',
  'polimer news',
  'puthiya thalaimurai',
  'thanthi tv',
  'news18 tamil',
  'star sports 1 tamil hd',
  'star sports 2 tamil hd',
  'willow tv',
  'willow',
  'sky sports cricket',
  'skyspcricket',
  'ind vs',
  'india vs',
  'sony yay tamil',
  'chutti tv',
  'wow kidz tamil',
];

function hasBlockedRegionalLanguage(text = '') {
  const value = String(text || '').toLowerCase();
  const allowedLanguage = /\btamil\b/.test(value);
  const blocked = /\b(english|eng|hindi|telugu|kannada|malayalam|bangla|bengali|marathi|gujarati|urdu|arabic|spanish|odia|punjabi|bhojpuri)\b/.test(value);
  return blocked && !allowedLanguage;
}

function hasBlockedLiveCategory(channel = {}) {
  const category = String(channel.category || channel.group || channel.groupTitle || channel['group-title'] || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  return /\b(extras?|usa|premium|premimum|izzigo|fm\s*radio|radio)\b/.test(category);
}

function isEnglishOnlyChannel(channel = {}) {
  const name = String(channel.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  const meta = `${channel.category || ''} ${channel.language || ''} ${channel.region || ''}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  const explicitEnglishName = /\b(willow|cnn\s*news18|cnn|bbc|cnbc|times\s*now|republic|ndtv\s*24x7|mirro?r\s*now|movies\s*now|romedy\s*now|mnx|sony\s*pix|star\s*movies|zee\s*cafe|zee\s*caf\b|history\s*tv18|discovery\s*hd|animal\s*planet|nat\s*geo|national\s*geographic)\b/.test(name);
  if (explicitEnglishName && !/\btamil\b/.test(name)) return true;
  return /\b(english|eng|usa)\b/.test(meta) && !/\btamil\b/.test(name);
}

function isPreferredCricketChannel(channel = {}) {
  const text = `${channel.name || ''} ${channel.category || ''} ${channel.language || ''} ${channel.region || ''}`.toLowerCase();
  if (hasBlockedLiveCategory(channel) || hasBlockedRegionalLanguage(text) || isEnglishOnlyChannel(channel)) return false;

  return (
    text.includes('star sports 1 tamil') ||
    text.includes('star sports 2 tamil') ||
    text.includes('sony sports ten 4 tamil') ||
    text.includes('sony ten 4 tamil') ||
    text.includes('sony liv sports 4 tamil')
  );
}

function isTamilMusicChannelText(text = '') {
  const value = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  return (
    /\bsun\s*music\b/.test(value) ||
    /\bjaya\s*max\b/.test(value) ||
    /\bjayamax\b/.test(value) ||
    /\braj\s*musix\b/.test(value) ||
    /\braj\s*music\b/.test(value) ||
    /\bisai\s*aruvi\b/.test(value) ||
    /\bisaiaruvi\b/.test(value) ||
    /\b7s\s*music\b/.test(value) ||
    /\bmega\s*musiq\b/.test(value) ||
    /\btamil\s*music\b/.test(value) ||
    /\bmurasu\b/.test(value)
  );
}

/**
 * v10.2.2 — what belongs in the Sports catalog, decided ONCE:
 *   (a) Indian sports channels (Star/Sony/DD/Sports18/FanCode families), and
 *   (b) cricket-centric channels from other countries (Willow, *Cricket*,
 *       PTV Sports, Ten Sports, T Sports, A Sports, CricLife…).
 * Everything else — beIN, Eurosport, DSports Argentina, Bahrain Sports,
 * TNT football — is unwanted. This is the function that decides it. A second
 * allow-list (SPORTS_ALLOW_PATTERN / isWantedSportsChannel) used to sit next to
 * it and was never called from anywhere, so it has been removed.
 */
function isSportsChannelText(text = '') {
  const value = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  return (
    /\bstar\s*sports\b/.test(value) ||
    /\bsports\b/.test(value) ||
    /\bcricket\b/.test(value) ||
    /\bwillow\b/.test(value) ||
    /\bsky\s*sports\s*cricket\b/.test(value) ||
    /\bfancode\b/.test(value) ||
    /\b(ind|india)\s*(vs|v|versus)\b/.test(value) ||
    /\b(vs|v|versus)\s*(ind|india)\b/.test(value)
  );
}

function isTamilChannel(channel, source = {}) {
  if (hasBlockedLiveCategory(channel)) return false;
  if (isPocketSource(source)) return isPocketWantedChannel(channel);
  if (isEnglishOnlyChannel(channel)) return false;
  if (source.trustTamil) return true;
  if (isPreferredCricketChannel(channel)) return true;

  const text = `${channel.name || ''} ${channel.category || ''} ${channel.language || ''} ${channel.region || ''}`.toLowerCase();
  if (hasBlockedRegionalLanguage(text)) return false;
  return (
    text.includes('tamil') ||
    text.includes('tam ') ||
    text.includes(' tamil') ||
    text.includes('sun tv') ||
    text.includes('star vijay') ||
    text.includes('vijay tv') ||
    text.includes('zee tamil') ||
    text.includes('jaya tv') ||
    text.includes('kalaignar') ||
    text.includes('polimer') ||
    text.includes('puthiyathalaimurai') ||
    text.includes('thanthi') ||
    text.includes('news18 tamil') ||
    text.includes('adithya') ||
    text.includes('sun music') ||
    text.includes('jaya max') ||
    text.includes('jayamax') ||
    text.includes('raj musix') ||
    text.includes('raj music') ||
    text.includes('isaiaruvi') ||
    text.includes('7s music') ||
    text.includes('mega musiq') ||
    text.includes('sirippoli') ||
    text.includes('chithiram') ||
    text.includes('murasu') ||
    text.includes('isaiaruvi') ||
    text.includes('raj tv') ||
    text.includes('roja')
  );
}

function popularityRank(channel = {}) {
  const name = normalizeWhitespace(channel.name).toLowerCase();
  const index = POPULAR_TAMIL_RULES.findIndex((rule) => name === rule || name.includes(rule));
  return index === -1 ? 9999 : index;
}

export {
  POPULAR_TAMIL_RULES,
  hasBlockedLiveCategory,
  hasBlockedRegionalLanguage,
  isEnglishOnlyChannel,
  isPocketRemovedChannel,
  isPocketWantedChannel,
  isPreferredCricketChannel,
  isSportsChannelText,
  isTamilChannel,
  isTamilMusicChannelText,
  parsePocketNameList,
  pocketCompactKey,
  pocketKey,
  popularityRank,
};
