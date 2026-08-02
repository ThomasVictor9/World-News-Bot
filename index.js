// World News Bot - Telegram bot
// -------------------------------
// Delivers breaking international news by category and country.
// - /news            -> interactive buttons (pick category, then country)
// - /news <country> <category>  -> text command, e.g. /news gb business
// - Auto-posts breaking headlines to a channel/group on a schedule (optional)

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cron = require('node-cron');

// ---- Config ----
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const NEWS_API_KEY = process.env.NEWS_API_KEY;
// Supports one or more destinations, comma-separated, e.g.
// AUTO_POST_CHAT_ID=-1001234567890,-100987654321
const AUTO_POST_CHAT_IDS = (process.env.AUTO_POST_CHAT_ID || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);
const AUTO_POST_COUNTRY = process.env.AUTO_POST_COUNTRY || 'us';
const AUTO_POST_CATEGORY = process.env.AUTO_POST_CATEGORY || 'general';
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 */3 * * *'; // every 3 hours by default

if (!BOT_TOKEN || !NEWS_API_KEY) {
  console.error('Missing TELEGRAM_BOT_TOKEN or NEWS_API_KEY in environment variables.');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ---- Supported categories & countries ----
const CATEGORIES = [
  { code: 'general', label: '🌍 World' },
  { code: 'business', label: '💼 Business' },
  { code: 'technology', label: '💻 Technology' },
  { code: 'sports', label: '🏆 Sports' },
  { code: 'health', label: '🏥 Health' },
  { code: 'entertainment', label: '🎬 Entertainment' },
  { code: 'science', label: '🔬 Science' },
];

const COUNTRIES = [
  { code: 'us', label: '🇺🇸 USA' },
  { code: 'gb', label: '🇬🇧 UK' },
  { code: 'ng', label: '🇳🇬 Nigeria' },
  { code: 'ca', label: '🇨🇦 Canada' },
  { code: 'au', label: '🇦🇺 Australia' },
  { code: 'in', label: '🇮🇳 India' },
  { code: 'za', label: '🇿🇦 South Africa' },
  { code: 'de', label: '🇩🇪 Germany' },
  { code: 'fr', label: '🇫🇷 France' },
  { code: 'jp', label: '🇯🇵 Japan' },
];

// Full display name for every country NewsAPI supports (used in messages
// and as the fallback search term).
const COUNTRY_NAMES = {
  ae: 'United Arab Emirates', ar: 'Argentina', at: 'Austria', au: 'Australia',
  be: 'Belgium', bg: 'Bulgaria', br: 'Brazil', ca: 'Canada', ch: 'Switzerland',
  cn: 'China', co: 'Colombia', cu: 'Cuba', cz: 'Czech Republic', de: 'Germany',
  eg: 'Egypt', fr: 'France', gb: 'United Kingdom', gr: 'Greece', hk: 'Hong Kong',
  hu: 'Hungary', id: 'Indonesia', ie: 'Ireland', il: 'Israel', in: 'India',
  it: 'Italy', jp: 'Japan', kr: 'South Korea', lt: 'Lithuania', lv: 'Latvia',
  ma: 'Morocco', mx: 'Mexico', my: 'Malaysia', ng: 'Nigeria', nl: 'Netherlands',
  no: 'Norway', nz: 'New Zealand', ph: 'Philippines', pl: 'Poland', pt: 'Portugal',
  ro: 'Romania', rs: 'Serbia', ru: 'Russia', sa: 'Saudi Arabia', se: 'Sweden',
  sg: 'Singapore', si: 'Slovenia', sk: 'Slovakia', th: 'Thailand', tr: 'Turkey',
  tw: 'Taiwan', ua: 'Ukraine', us: 'United States', ve: 'Venezuela', za: 'South Africa',
};

// Every name/alias a person might type, mapped to the NewsAPI country code.
// This is what lets "Nigeria", "USA", "US", "United States", "Uk", and
// "United Kingdom" all resolve correctly.
const COUNTRY_ALIASES = {
  'united arab emirates': 'ae', 'uae': 'ae', 'emirati': 'ae',
  'argentina': 'ar', 'argentinian': 'ar', 'argentine': 'ar',
  'austria': 'at', 'austrian': 'at',
  'australia': 'au', 'australian': 'au',
  'belgium': 'be', 'belgian': 'be',
  'bulgaria': 'bg', 'bulgarian': 'bg',
  'brazil': 'br', 'brazilian': 'br',
  'canada': 'ca', 'canadian': 'ca',
  'switzerland': 'ch', 'swiss': 'ch',
  'china': 'cn', 'chinese': 'cn',
  'colombia': 'co', 'colombian': 'co',
  'cuba': 'cu', 'cuban': 'cu',
  'czech republic': 'cz', 'czechia': 'cz', 'czech': 'cz',
  'germany': 'de', 'german': 'de',
  'egypt': 'eg', 'egyptian': 'eg',
  'france': 'fr', 'french': 'fr',
  'united kingdom': 'gb', 'uk': 'gb', 'britain': 'gb', 'great britain': 'gb',
  'england': 'gb', 'british': 'gb', 'english': 'gb',
  'greece': 'gr', 'greek': 'gr',
  'hong kong': 'hk',
  'hungary': 'hu', 'hungarian': 'hu',
  'indonesia': 'id', 'indonesian': 'id',
  'ireland': 'ie', 'irish': 'ie',
  'israel': 'il', 'israeli': 'il',
  'india': 'in', 'indian': 'in',
  'italy': 'it', 'italian': 'it',
  'japan': 'jp', 'japanese': 'jp',
  'south korea': 'kr', 'korea': 'kr', 'korean': 'kr',
  'lithuania': 'lt', 'lithuanian': 'lt',
  'latvia': 'lv', 'latvian': 'lv',
  'morocco': 'ma', 'moroccan': 'ma',
  'mexico': 'mx', 'mexican': 'mx',
  'malaysia': 'my', 'malaysian': 'my',
  'nigeria': 'ng', 'nigerian': 'ng',
  'netherlands': 'nl', 'holland': 'nl', 'dutch': 'nl',
  'norway': 'no', 'norwegian': 'no',
  'new zealand': 'nz', 'kiwi': 'nz',
  'philippines': 'ph', 'filipino': 'ph', 'philippine': 'ph',
  'poland': 'pl', 'polish': 'pl',
  'portugal': 'pt', 'portuguese': 'pt',
  'romania': 'ro', 'romanian': 'ro',
  'serbia': 'rs', 'serbian': 'rs',
  'russia': 'ru', 'russian': 'ru',
  'saudi arabia': 'sa', 'saudi': 'sa',
  'sweden': 'se', 'swedish': 'se',
  'singapore': 'sg', 'singaporean': 'sg',
  'slovenia': 'si', 'slovenian': 'si',
  'slovakia': 'sk', 'slovak': 'sk',
  'thailand': 'th', 'thai': 'th',
  'turkey': 'tr', 'turkiye': 'tr', 'turkish': 'tr',
  'taiwan': 'tw', 'taiwanese': 'tw',
  'ukraine': 'ua', 'ukrainian': 'ua',
  'united states': 'us', 'usa': 'us', 'us': 'us', 'america': 'us', 'american': 'us',
  'united states of america': 'us',
  'venezuela': 've', 'venezuelan': 've',
  'south africa': 'za', 'south african': 'za',
};

// Resolve whatever a person typed ("Nigeria", "USA", "uk", "ng"...) into a
// NewsAPI country code. Returns null if nothing matches.
function resolveCountry(input) {
  const normalized = input.trim().toLowerCase();
  if (COUNTRY_NAMES[normalized]) return normalized; // already a valid code
  if (COUNTRY_ALIASES[normalized]) return COUNTRY_ALIASES[normalized];
  return null;
}

// Temporary in-memory state: remembers the category a user picked
// while they're choosing a country via buttons.
const pendingSelection = {}; // { chatId: categoryCode }

// ---- Helper: fetch news from NewsAPI, with a fallback search ----
// Some countries (e.g. Nigeria) have very few sources indexed under
// /top-headlines on the free tier, so it often comes back empty even
// with a correct country code. If that happens, fall back to a broader
// /everything search for that country's news instead of giving up.
async function fetchNews(country, category) {
  const articles = await fetchTopHeadlines(country, category);
  if (articles.length > 0) {
    return articles;
  }

  console.log(`No top-headlines for ${country}/${category}, trying fallback search...`);
  return fetchFallbackSearch(country, category);
}

async function fetchTopHeadlines(country, category) {
  try {
    const response = await axios.get('https://newsapi.org/v2/top-headlines', {
      params: {
        apiKey: NEWS_API_KEY,
        country,
        category,
        pageSize: 6,
      },
    });
    return response.data.articles || [];
  } catch (error) {
    console.error('Error fetching top-headlines:', error.response?.data || error.message);
    return [];
  }
}

async function fetchFallbackSearch(country, category) {
  try {
    const countryName = COUNTRY_NAMES[country] || country;
    const query = category === 'general' ? countryName : `${countryName} ${category}`;

    const response = await axios.get('https://newsapi.org/v2/everything', {
      params: {
        apiKey: NEWS_API_KEY,
        q: query,
        language: 'en',
        sortBy: 'publishedAt',
        pageSize: 6,
      },
    });
    return response.data.articles || [];
  } catch (error) {
    console.error('Error fetching fallback search:', error.response?.data || error.message);
    return [];
  }
}

// ---- Free-text topic search (e.g. "football", "basketball", "elections") ----
// The 7 fixed NewsAPI categories only cover broad buckets, so anything else
// typed by the user (a sport, an event, a person, etc.) is searched directly.
async function fetchTopicSearch(country, topic) {
  try {
    const countryName = COUNTRY_NAMES[country] || country;
    const response = await axios.get('https://newsapi.org/v2/everything', {
      params: {
        apiKey: NEWS_API_KEY,
        q: `${topic} ${countryName}`,
        language: 'en',
        sortBy: 'publishedAt',
        pageSize: 6,
      },
    });
    return response.data.articles || [];
  } catch (error) {
    console.error('Error fetching topic search:', error.response?.data || error.message);
    return [];
  }
}

// ---- Helper: format articles for a Telegram message ----
function formatArticles(articles, title) {
  if (!articles.length) {
    return `No news found for "${title}" right now. Try a different category or country.`;
  }

  let message = `*${title}*\n\n`;
  articles.forEach((article, i) => {
    message += `${i + 1}. [${article.title}](${article.url})\n`;
    if (article.source?.name) {
      message += `   _${article.source.name}_\n`;
    }
    message += '\n';
  });
  return message;
}

function categoryLabel(code) {
  return CATEGORIES.find((c) => c.code === code)?.label || code;
}
function countryLabel(code) {
  const quickPick = COUNTRIES.find((c) => c.code === code);
  if (quickPick) return quickPick.label;
  return COUNTRY_NAMES[code] || code;
}

// ---- /start ----
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    '🌍 *Welcome to World News Bot*\n\n' +
      'Get breaking international news by country, and optionally any topic.\n\n' +
      'Use /news to pick with buttons, or type a command directly:\n' +
      '`/news <country> [topic]`\n' +
      'Examples:\n' +
      '`/news Nigeria` - general breaking news\n' +
      '`/news Nigeria football`\n' +
      '`/news Nigerian basketball`\n' +
      '`/news USA business`\n' +
      '`/news United Kingdom elections`\n\n' +
      '⚠️ Always leave a space between the country and the topic (e.g. "USA football", not "USAfootball").\n\n' +
      'Type /countries to see everything I support.',
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    'Commands:\n' +
      '/news - pick category & country with buttons\n' +
      '/news <country> [topic] - direct command, e.g. /news Nigeria football or /news USA business\n' +
      '/categories - list the 7 fixed news categories\n' +
      '/countries - list supported countries\n\n' +
      'You can also type any topic (a sport, event, name, etc.), not just the fixed categories.'
  );
});

bot.onText(/\/categories/, (msg) => {
  const list = CATEGORIES.map((c) => `${c.code} - ${c.label}`).join('\n');
  bot.sendMessage(msg.chat.id, `*Categories:*\n${list}`, { parse_mode: 'Markdown' });
});

bot.onText(/\/countries/, (msg) => {
  const names = Object.values(COUNTRY_NAMES).sort();
  const list = names.join(', ');
  bot.sendMessage(
    msg.chat.id,
    `*Supported countries* (type the full name, e.g. "Nigeria", "United Kingdom", "USA"):\n\n${list}`,
    { parse_mode: 'Markdown' }
  );
});

// ---- /news (no args) -> show category buttons ----
// ---- /news <country name(s)> [topic] -> direct fetch ----
// Examples: /news Nigeria | /news United Kingdom business | /news Nigeria football | /news USA basketball
const CATEGORY_CODES = CATEGORIES.map((c) => c.code);

// Try to match a country name at the START of the given words, checking the
// longest possible phrase first (so "United Kingdom" matches before just
// "United", and "South Africa" before "South"). Returns the matched country
// code and how many words it consumed, or null if nothing matched.
function matchCountryPrefix(words) {
  const maxWords = Math.min(4, words.length);
  for (let len = maxWords; len >= 1; len--) {
    const phrase = words.slice(0, len).join(' ');
    const country = resolveCountry(phrase);
    if (country) {
      return { country, consumed: len };
    }
  }
  return null;
}

bot.onText(/^\/news(?:\s+(.+))?$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const input = match[1]?.trim();

  if (!input) {
    // No args given -> show category buttons first
    const keyboard = {
      inline_keyboard: chunk(
        CATEGORIES.map((c) => ({ text: c.label, callback_data: `cat:${c.code}` })),
        2
      ),
    };
    bot.sendMessage(chatId, 'Pick a category:', { reply_markup: keyboard });
    return;
  }

  const words = input.split(/\s+/);
  const matched = matchCountryPrefix(words);

  if (!matched) {
    bot.sendMessage(
      chatId,
      `I couldn't recognize a country at the start of "${input}". Make sure to leave a space between the country and topic (e.g. "USA football", not "USAfootball"). Type /countries to see everything I support.`
    );
    return;
  }

  const { country } = matched;
  const topic = words.slice(matched.consumed).join(' ').trim();

  await sendNews(chatId, country, topic);
});

// ---- Handle button taps ----
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (data.startsWith('cat:')) {
    const category = data.split(':')[1];
    pendingSelection[chatId] = category;

    const keyboard = {
      inline_keyboard: chunk(
        COUNTRIES.map((c) => ({ text: c.label, callback_data: `country:${c.code}` })),
        2
      ),
    };
    await bot.editMessageText(`Category: ${categoryLabel(category)}\nNow pick a country:`, {
      chat_id: chatId,
      message_id: query.message.message_id,
      reply_markup: keyboard,
    });
  } else if (data.startsWith('country:')) {
    const country = data.split(':')[1];
    const category = pendingSelection[chatId] || 'general';
    delete pendingSelection[chatId];

    await bot.editMessageText(
      `Fetching ${categoryLabel(category)} news for ${countryLabel(country)}...`,
      { chat_id: chatId, message_id: query.message.message_id }
    );
    await sendNews(chatId, country, category);
  }

  bot.answerCallbackQuery(query.id);
});

// ---- Shared: fetch + send news ----
// `topicOrCategory` can be empty (general breaking news), one of the 7 fixed
// categories (business, sports, etc.), or any free-text topic (football,
// basketball, elections, a person's name, ...).
async function sendNews(chatId, country, topicOrCategory) {
  const value = (topicOrCategory || '').trim().toLowerCase();

  let articles;
  let title;

  if (!value || value === 'general') {
    articles = await fetchNews(country, 'general');
    title = `🌍 World - ${countryLabel(country)}`;
  } else if (CATEGORY_CODES.includes(value)) {
    articles = await fetchNews(country, value);
    title = `${categoryLabel(value)} - ${countryLabel(country)}`;
  } else {
    articles = await fetchTopicSearch(country, topicOrCategory);
    title = `${capitalize(topicOrCategory)} - ${countryLabel(country)}`;
  }

  const message = formatArticles(articles, title);
  bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
}

function capitalize(text) {
  return text.replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---- Utility: split array into chunks (for keyboard rows) ----
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

// ---- Auto-post breaking news (optional, supports multiple destinations) ----
if (AUTO_POST_CHAT_IDS.length > 0) {
  cron.schedule(CRON_SCHEDULE, async () => {
    console.log('Running scheduled breaking news post...');
    const articles = await fetchNews(AUTO_POST_COUNTRY, AUTO_POST_CATEGORY);
    const title = `🚨 Breaking News - ${categoryLabel(AUTO_POST_CATEGORY)} (${countryLabel(AUTO_POST_COUNTRY)})`;
    const message = formatArticles(articles, title);

    for (const destination of AUTO_POST_CHAT_IDS) {
      try {
        await bot.sendMessage(destination, message, { parse_mode: 'Markdown' });
      } catch (error) {
        console.error(`Error auto-posting to ${destination}:`, error.response?.body || error.message);
      }
    }
  });
  console.log(
    `Auto-post scheduled: "${CRON_SCHEDULE}" -> chats [${AUTO_POST_CHAT_IDS.join(', ')}] (${AUTO_POST_COUNTRY}/${AUTO_POST_CATEGORY})`
  );
} else {
  console.log('AUTO_POST_CHAT_ID not set — auto-posting disabled (on-demand /news still works).');
}

console.log('World News Bot is running...');
