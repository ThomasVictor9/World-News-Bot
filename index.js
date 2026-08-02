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
  'united arab emirates': 'ae', 'uae': 'ae',
  'argentina': 'ar',
  'austria': 'at',
  'australia': 'au',
  'belgium': 'be',
  'bulgaria': 'bg',
  'brazil': 'br',
  'canada': 'ca',
  'switzerland': 'ch',
  'china': 'cn',
  'colombia': 'co',
  'cuba': 'cu',
  'czech republic': 'cz', 'czechia': 'cz',
  'germany': 'de',
  'egypt': 'eg',
  'france': 'fr',
  'united kingdom': 'gb', 'uk': 'gb', 'britain': 'gb', 'great britain': 'gb', 'england': 'gb',
  'greece': 'gr',
  'hong kong': 'hk',
  'hungary': 'hu',
  'indonesia': 'id',
  'ireland': 'ie',
  'israel': 'il',
  'india': 'in',
  'italy': 'it',
  'japan': 'jp',
  'south korea': 'kr', 'korea': 'kr',
  'lithuania': 'lt',
  'latvia': 'lv',
  'morocco': 'ma',
  'mexico': 'mx',
  'malaysia': 'my',
  'nigeria': 'ng',
  'netherlands': 'nl', 'holland': 'nl',
  'norway': 'no',
  'new zealand': 'nz',
  'philippines': 'ph',
  'poland': 'pl',
  'portugal': 'pt',
  'romania': 'ro',
  'serbia': 'rs',
  'russia': 'ru',
  'saudi arabia': 'sa',
  'sweden': 'se',
  'singapore': 'sg',
  'slovenia': 'si',
  'slovakia': 'sk',
  'thailand': 'th',
  'turkey': 'tr', 'turkiye': 'tr',
  'taiwan': 'tw',
  'ukraine': 'ua',
  'united states': 'us', 'usa': 'us', 'us': 'us', 'america': 'us', 'united states of america': 'us',
  'venezuela': 've',
  'south africa': 'za',
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
      'Get breaking international news by category and country.\n\n' +
      'Use /news to pick with buttons, or type a command directly:\n' +
      '`/news <country> [category]`\n' +
      'Examples: `/news Nigeria`, `/news United Kingdom business`, `/news USA`\n\n' +
      'Type /countries or /categories to see everything I support.',
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    'Commands:\n' +
      '/news - pick category & country with buttons\n' +
      '/news <country> [category] - direct command, e.g. /news Nigeria or /news United Kingdom business\n' +
      '/categories - list category codes\n' +
      '/countries - list supported countries'
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
// ---- /news <country name(s)> [category] -> direct fetch, e.g. /news Nigeria, /news United Kingdom business ----
const CATEGORY_CODES = CATEGORIES.map((c) => c.code);

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

  // Check if the last word is a valid category (e.g. "Nigeria business").
  // Everything before it is treated as the country name. If the last word
  // isn't a recognized category, treat the whole input as the country name
  // and default to general/breaking news.
  const words = input.split(/\s+/);
  const lastWord = words[words.length - 1].toLowerCase();
  let category = 'general';
  let countryText = input;

  if (CATEGORY_CODES.includes(lastWord)) {
    category = lastWord;
    countryText = words.slice(0, -1).join(' ');
  }

  const country = resolveCountry(countryText);

  if (!country) {
    bot.sendMessage(
      chatId,
      `I couldn't recognize "${countryText}" as a country. Try the full name (e.g. Nigeria, United Kingdom, USA) or type /countries to see everything I support.`
    );
    return;
  }

  await sendNews(chatId, country, category);
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
async function sendNews(chatId, country, category) {
  const articles = await fetchNews(country, category);
  const title = `${categoryLabel(category)} - ${countryLabel(country)}`;
  const message = formatArticles(articles, title);
  bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
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
