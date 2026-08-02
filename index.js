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
const AUTO_POST_CHAT_ID = process.env.AUTO_POST_CHAT_ID;
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

// Temporary in-memory state: remembers the category a user picked
// while they're choosing a country via buttons.
const pendingSelection = {}; // { chatId: categoryCode }

// ---- Helper: fetch news from NewsAPI ----
async function fetchNews(country, category) {
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
    console.error('Error fetching news:', error.response?.data || error.message);
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
  return COUNTRIES.find((c) => c.code === code)?.label || code;
}

// ---- /start ----
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    '🌍 *Welcome to World News Bot*\n\n' +
      'Get breaking international news by category and country.\n\n' +
      'Use /news to pick with buttons, or type a command directly:\n' +
      '`/news <country> <category>`\n' +
      'Example: `/news gb business`\n\n' +
      'Type /countries or /categories to see the available codes.',
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    'Commands:\n' +
      '/news - pick category & country with buttons\n' +
      '/news <country> <category> - direct text command, e.g. /news us technology\n' +
      '/categories - list category codes\n' +
      '/countries - list country codes'
  );
});

bot.onText(/\/categories/, (msg) => {
  const list = CATEGORIES.map((c) => `${c.code} - ${c.label}`).join('\n');
  bot.sendMessage(msg.chat.id, `*Categories:*\n${list}`, { parse_mode: 'Markdown' });
});

bot.onText(/\/countries/, (msg) => {
  const list = COUNTRIES.map((c) => `${c.code} - ${c.label}`).join('\n');
  bot.sendMessage(msg.chat.id, `*Countries:*\n${list}`, { parse_mode: 'Markdown' });
});

// ---- /news (no args) -> show category buttons ----
// ---- /news <country> <category> -> direct fetch ----
bot.onText(/^\/news(?:\s+(\S+)\s+(\S+))?$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const country = match[1]?.toLowerCase();
  const category = match[2]?.toLowerCase();

  if (country && category) {
    await sendNews(chatId, country, category);
    return;
  }

  // No args given -> show category buttons first
  const keyboard = {
    inline_keyboard: chunk(
      CATEGORIES.map((c) => ({ text: c.label, callback_data: `cat:${c.code}` })),
      2
    ),
  };
  bot.sendMessage(chatId, 'Pick a category:', { reply_markup: keyboard });
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

// ---- Auto-post breaking news (optional) ----
if (AUTO_POST_CHAT_ID) {
  cron.schedule(CRON_SCHEDULE, async () => {
    console.log('Running scheduled breaking news post...');
    const articles = await fetchNews(AUTO_POST_COUNTRY, AUTO_POST_CATEGORY);
    const title = `🚨 Breaking News - ${categoryLabel(AUTO_POST_CATEGORY)} (${countryLabel(AUTO_POST_COUNTRY)})`;
    const message = formatArticles(articles, title);
    try {
      await bot.sendMessage(AUTO_POST_CHAT_ID, message, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Error auto-posting:', error.response?.body || error.message);
    }
  });
  console.log(
    `Auto-post scheduled: "${CRON_SCHEDULE}" -> chat ${AUTO_POST_CHAT_ID} (${AUTO_POST_COUNTRY}/${AUTO_POST_CATEGORY})`
  );
} else {
  console.log('AUTO_POST_CHAT_ID not set — auto-posting disabled (on-demand /news still works).');
}

console.log('World News Bot is running...');
