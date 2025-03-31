require("dotenv").config();
const fs = require("fs");
const TelegramBot = require("node-telegram-bot-api");
const { Together } = require("together-ai");

// ⚙️ Configuration & Setup
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TOGETHER_AI_API_KEY = process.env.TOGETHER_AI_API_KEY;
const ADMIN_ID = Number(process.env.ADMIN_ID);
const PUBLIC_CHANNEL_ID = Number(process.env.PUBLIC_CHANNEL_ID);
const RESTRICTED_TOPIC_ID = Number(process.env.RESTRICTED_TOPIC_ID);
const PRIVATE_GROUP_ID = process.env.PRIVATE_GROUP_ID;
const PRIVATE_GROUP_INVITE_LINK = process.env.PRIVATE_GROUP_INVITE_LINK || "https://t.me/+zgS8UCh32NUwMTc0";

// ✅ Validate Environment Variables (with more informative errors/warnings)
function validateEnvironmentVariables() {
    if (!BOT_TOKEN) {
        console.error("❌ Environment variable BOT_TOKEN is missing. Please set your Telegram Bot Token.");
        process.exit(1);
    }

    if (!TOGETHER_AI_API_KEY) {
        console.warn("⚠️ Environment variable TOGETHER_AI_API_KEY is missing. AI features will be disabled. To enable AI, set your Together AI API Key.");
    }

    if (isNaN(ADMIN_ID)) {
        console.error("❌ Environment variable ADMIN_ID is missing or not a valid number. Please set your Telegram Admin ID.");
        process.exit(1);
    }

    if (isNaN(PUBLIC_CHANNEL_ID)) {
        console.error("❌ Environment variable PUBLIC_CHANNEL_ID is missing or not a valid number. Please set your Public Channel ID.");
        process.exit(1);
    }

    if (isNaN(RESTRICTED_TOPIC_ID) && process.env.RESTRICTED_TOPIC_ID) { // Check if env var is present but not a number
        console.warn("⚠️ Environment variable RESTRICTED_TOPIC_ID is not a valid number. Topic restriction will be disabled or not functioning correctly.");
    } else if (isNaN(RESTRICTED_TOPIC_ID)) {
        console.warn("⚠️ Environment variable RESTRICTED_TOPIC_ID is missing. Topic restriction will be disabled.");
    }


    if (!PRIVATE_GROUP_ID) {
        console.warn("⚠️ Environment variable PRIVATE_GROUP_ID is missing. Auto-join to private group after verification will be disabled.");
    }
}

validateEnvironmentVariables();

// ✅ Initialize Telegram Bot & Together AI (conditional)
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const together = TOGETHER_AI_API_KEY ? new Together({ apiKey: TOGETHER_AI_API_KEY }) : null;

// 🗂️ Data Storage & Loading (Improved Error Handling)
const BOT_DATA_FILE = "data.json";
const VERIFIED_USERS_FILE = "verified_users.json";
const LAST_VERIFICATION_MESSAGE_FILE = "last_verification_message.json";

let botData = loadBotData();
let verifiedUsers = loadVerifiedUsers();
let lastVerificationMessage = loadLastVerificationMessage();

function loadBotData() {
    try {
        const rawData = fs.readFileSync(BOT_DATA_FILE, "utf8");
        return JSON.parse(rawData);
    } catch (error) {
        console.error(`❌ Error loading ${BOT_DATA_FILE}: ${error.code === 'ENOENT' ? 'File not found.' : 'JSON parse error or other error.'}`, error);
        return { verification_keywords: [], verification_reference: "⚠️ بيانات التوثيق غير متاحة. الرجاء التحقق من ملف data.json." };
    }
}

function loadVerifiedUsers() {
    try {
        const rawData = fs.readFileSync(VERIFIED_USERS_FILE, "utf8");
        return JSON.parse(rawData);
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.warn(`⚠️ Warning: ${VERIFIED_USERS_FILE} not found. Starting with empty verified users list.`);
        } else {
            console.warn(`⚠️ Warning: Error loading ${VERIFIED_USERS_FILE}. Starting with empty verified users list.`, error);
        }
        return {};
    }
}

function saveVerifiedUsers(users) {
    try {
        fs.writeFileSync(VERIFIED_USERS_FILE, JSON.stringify(users, null, 2));
    } catch (error) {
        console.error(`❌ Error saving to ${VERIFIED_USERS_FILE}:`, error);
    }
}

function loadLastVerificationMessage() {
    try {
        const rawData = fs.readFileSync(LAST_VERIFICATION_MESSAGE_FILE, "utf8");
        return JSON.parse(rawData);
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.warn(`⚠️ Warning: ${LAST_VERIFICATION_MESSAGE_FILE} not found. Starting with default last verification message.`);
        } else {
            console.warn(`⚠️ Warning: Error loading ${LAST_VERIFICATION_MESSAGE_FILE}. Starting with default last verification message.`, error);
        }
        return { messageId: null };
    }
}

function saveLastVerificationMessage(messageId) {
    try {
        fs.writeFileSync(LAST_VERIFICATION_MESSAGE_FILE, JSON.stringify({ messageId }));
    } catch (error) {
        console.error(`❌ Error saving to ${LAST_VERIFICATION_MESSAGE_FILE}:`, error);
    }
}

// ⏳ Verification Session Management
const verificationSessions = {};
const pendingApprovals = {};

// 🚫 Message Restriction in Specific Topic
async function handleRestrictedTopicMessage(msg) {
    if (!RESTRICTED_TOPIC_ID) return;

    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const topicId = msg.message_thread_id;

    if (topicId === RESTRICTED_TOPIC_ID && userId !== ADMIN_ID) {
        try {
            await bot.deleteMessage(chatId, msg.message_id);
            console.log(`🗑️ Deleted message from user ${userId} in restricted topic.`);
        } catch (error) {
            console.error("❌ Error deleting message in restricted topic:", error);
        }
    }
}

// 💬 Command Handlers (Structured Command Handling)
const commandHandlers = {
    "chat": async (msg, args) => {
        const userId = msg.from.id;
        if (!together) {
            bot.sendMessage(userId, "⚠️ ميزة الدردشة بالذكاء الاصطناعي معطلة بسبب عدم تعيين TOGETHER_AI_API_KEY.");
            return;
        }
        const query = args.join(" ").trim();
        if (query) {
            bot.sendMessage(userId, "🤖 جاري التفكير...");
            try {
                const responseText = await generateGeneralChatResponse(query);
                bot.sendMessage(userId, responseText);
            } catch (apiError) {
                console.error("❌ خطأ في توليد استجابة الذكاء الاصطناعي:", apiError);
                bot.sendMessage(userId, "⚠️ خدمة الذكاء الاصطناعي غير متوفرة حاليًا. يرجى المحاولة لاحقًا.");
            }
        } else {
            bot.sendMessage(userId, "➡️ الاستخدام: `/chat [سؤالك]`");
        }
    },
    "sendverify": async (msg) => {
        const userId = msg.from.id;

        if (userId !== ADMIN_ID) {
            bot.sendMessage(userId, "❌ هذا الأمر مخصص فقط للمسؤول.");
            return;
        }

        const verificationText = "📢 هل ترغب في التقدم للتحقق؟ اضغط على الزر أدناه لبدء العملية.";
        const verificationKeyboard = {
            reply_markup: {
                inline_keyboard: [[{ text: "📝 التقدم للتحقق", callback_data: "start_verification" }]]
            }
        };

        try {
            if (lastVerificationMessage.messageId) {
                try {
                    await bot.editMessageText(verificationText, {
                        chat_id: PUBLIC_CHANNEL_ID,
                        message_id: lastVerificationMessage.messageId,
                        ...verificationKeyboard
                    });
                    console.log(`✅ تم تحديث رسالة التحقق في القناة ${PUBLIC_CHANNEL_ID}`);
                    bot.sendMessage(userId, "✅ تم تحديث رسالة التحقق بنجاح!");
                } catch (editError) {
                    if (editError.response && editError.response.statusCode === 400 && editError.response.body.description === "Bad Request: message to edit not found") {
                        // Message not found, likely deleted, send a new one
                        const message = await bot.sendMessage(PUBLIC_CHANNEL_ID, verificationText, verificationKeyboard);
                        lastVerificationMessage.messageId = message.message_id;
                        saveLastVerificationMessage(message.message_id);
                        console.log(`✅ تم إرسال رسالة تحقق جديدة إلى القناة ${PUBLIC_CHANNEL_ID} (الرسالة السابقة غير موجودة)`);
                        bot.sendMessage(userId, "✅ تم إرسال رسالة التحقق بنجاح!");
                    } else {
                        // Log other edit errors for debugging
                        console.error("❌ خطأ أثناء تحديث رسالة التحقق:", editError);
                        console.error("⚠️ تفاصيل الخطأ:", editError.response?.body || editError);
                        const message = await bot.sendMessage(PUBLIC_CHANNEL_ID, verificationText, verificationKeyboard);
                        lastVerificationMessage.messageId = message.message_id;
                        saveLastVerificationMessage(message.message_id);
                        console.log(`✅ تم إرسال رسالة تحقق جديدة إلى القناة ${PUBLIC_CHANNEL_ID} (تم إرسال رسالة جديدة كحل بديل بسبب خطأ في التحديث)`);
                        bot.sendMessage(userId, "⚠️ حدث خطأ أثناء تحديث الرسالة، ولكن تم إرسال رسالة تحقق جديدة!");
                    }
                }

            } else {
                const message = await bot.sendMessage(PUBLIC_CHANNEL_ID, verificationText, verificationKeyboard);
                lastVerificationMessage.messageId = message.message_id;
                saveLastVerificationMessage(message.message_id);
                console.log(`✅ تم إرسال رسالة تحقق جديدة إلى القناة ${PUBLIC_CHANNEL_ID}`);
                bot.sendMessage(userId, "✅ تم إرسال رسالة التحقق بنجاح!");
            }
        } catch (error) {
            console.error("❌ خطأ فادح في إرسال أو تحديث رسالة التحقق:", error);
            console.error("⚠️ تفاصيل الخطأ:", error);
            bot.sendMessage(userId, "❌ فشل فادح في إرسال/تحديث رسالة التحقق. تحقق من السجلات والأخطاء.");
        }
    },
};


// 💬 Handle User Messages and Verification Answers
bot.on("message", async (msg) => {
    await handleRestrictedTopicMessage(msg); // First handle topic restriction

    const userId = msg.from.id;
    const userInput = msg.text?.trim();

    if (!userInput) return;

    // ✅ Handle Reply from anyone (AI Chat on Reply) - Modified to reply to everyone
    if (msg.reply_to_message) { // Removed admin ID check
        if (!together) {
            bot.sendMessage(userId, "⚠️ ميزة الدردشة بالذكاء الاصطناعي معطلة بسبب عدم تعيين TOGETHER_AI_API_KEY.");
            return;
        }
        bot.sendMessage(msg.chat.id, "🤖 جاري التفكير في الرد..."); // Changed to msg.chat.id to inform in the same chat
        try {
            const query = userInput;
            const responseText = await generateGeneralChatResponse(query);
            bot.sendMessage(msg.chat.id, responseText, { reply_to_message_id: msg.message_id }); // Changed to msg.chat.id to reply in the same chat
        } catch (apiError) {
            console.error("❌ خطأ في توليد استجابة الذكاء الاصطناعي عند الرد:", apiError);
            bot.sendMessage(msg.chat.id, "⚠️ خدمة الذكاء الاصطناعي غير متوفرة حاليًا. يرجى المحاولة لاحقًا.", { reply_to_message_id: msg.message_id }); // Changed to msg.chat.id to reply in the same chat
        }
        return; // Stop processing further message logic
    }


    // ✅ Handle Verification Answer
    if (verificationSessions[userId]) {
        pendingApprovals[userId] = { question: verificationSessions[userId].question, answer: userInput };

        try {
            await sendVerificationAnswerToAdmin(msg, userInput);
            await bot.sendMessage(userId, "⏳ تم إرسال إجابتك إلى المسؤول. انتظر الموافقة...");
            delete verificationSessions[userId];
        } catch (error) {
            console.error("❌ Error handling verification answer or sending admin message:", error);
            bot.sendMessage(userId, "❌ Sorry, there was an error processing your answer. Please try again later.");
        }
        return;
    }

    // ✅ Handle Commands
    if (userInput.startsWith("/")) {
        const commandName = userInput.split(" ")[0].substring(1).toLowerCase(); // Extract command name
        const args = userInput.split(" ").slice(1); // Extract arguments
        const handler = commandHandlers[commandName];
        if (handler) {
            await handler(msg, args);
        } else {
            // bot.sendMessage(userId, "❌ أمر غير معروف."); // Optional: Inform user about unknown command
        }
        return;
    }
});

async function sendVerificationAnswerToAdmin(msg, userAnswer) {
    const userId = msg.from.id;
    await bot.sendMessage(
        ADMIN_ID,
        `🔔 **طلب تحقق جديد!**\n👤 المستخدم: ${msg.from.first_name} (ID: ${userId})\n\n📝 **سؤال التحقق:**\n${verificationSessions[userId].question}\n\n✍️ **إجابة المستخدم:**\n${userAnswer}`,
        {
            parse_mode: "Markdown",
            reply_markup: {
                inline_keyboard: [
                    [{ text: "✅ قبول", callback_data: `approve_${userId}` }],
                    [{ text: "❌ رفض", callback_data: `reject_${userId}` }]
                ]
            }
        }
    );
}


// 🖱️ Handle Callback Queries (Button Clicks)
bot.on("callback_query", async (query) => {
    const userId = query.from.id;
    const data = query.data;

    if (data === "start_verification") {
        await handleStartVerificationCallback(query);
    } else if (data.startsWith("approve_") || data.startsWith("reject_")) {
        await handleApprovalRejectionCallback(query);
    }
    bot.answerCallbackQuery(query.id);
});

async function handleStartVerificationCallback(query) {
    const userId = query.from.id;
    if (verifiedUsers[userId]) {
        bot.sendMessage(userId, "✅ أنت بالفعل مستخدم موثق.");
        return;
    }

    const verificationQuestion = "ما هو الغرض من التحقق في هذا المجتمع؟"; // ✅ Static Arabic Verification Question
    verificationSessions[userId] = { question: verificationQuestion };

    try {
        await bot.sendMessage(userId, `📝 **سؤال التحقق:**\n${verificationQuestion}\n\n💡 **أرسل إجابتك الآن.**`, { parse_mode: "Markdown" });
    } catch (error) {
        console.error("❌ خطأ في إرسال سؤال التحقق إلى المستخدم:", error);
        bot.sendMessage(userId, "❌ فشل بدء عملية التحقق. يرجى المحاولة لاحقًا.");
    }
}

async function handleApprovalRejectionCallback(query) {
    const userId = query.from.id;
    const data = query.data;

    if (userId !== ADMIN_ID) {
        bot.answerCallbackQuery(query.id, { text: "❌ إجراءات المسؤول فقط!" });
        return;
    }

    const [action, targetUserId] = data.split("_");
    const targetUserIdNum = Number(targetUserId);

    if (!pendingApprovals[targetUserIdNum]) {
        bot.answerCallbackQuery(query.id, { text: "⚠️ طلب الموافقة منتهي الصلاحية أو غير موجود." });
        return;
    }

    if (action === "approve") {
        await approveUserVerification(targetUserIdNum, query);
    } else if (action === "reject") {
        await rejectUserVerification(targetUserIdNum, query);
    }
    delete pendingApprovals[targetUserIdNum];
}


async function approveUserVerification(targetUserIdNum, query) {
    verifiedUsers[targetUserIdNum] = true;
    saveVerifiedUsers(verifiedUsers);
    try {
        await bot.sendMessage(targetUserIdNum, "🎉 تهانينا! تم توثيق حسابك بنجاح.");

        if (PRIVATE_GROUP_ID) {
            try {
                await bot.telegram.addChatMember(PRIVATE_GROUP_ID, targetUserIdNum);
                console.log(`✅ User ${targetUserIdNum} added to private group ${PRIVATE_GROUP_ID}`);
                await bot.sendMessage(targetUserIdNum, `🎉 تم أيضًا إضافتك إلى المجموعة الخاصة بالمستخدمين الموثوقين!`);
            } catch (joinError) {
                console.error(`❌ Error adding user ${targetUserIdNum} to private group ${PRIVATE_GROUP_ID}:`, joinError);
                await bot.sendMessage(targetUserIdNum, `⚠️ حدث خطأ أثناء إضافتك تلقائيًا إلى المجموعة الخاصة. يرجى الانضمام باستخدام هذا الرابط: ${PRIVATE_GROUP_INVITE_LINK}`);
                await bot.sendMessage(ADMIN_ID, `⚠️ فشل إضافة المستخدم ${targetUserIdNum} إلى المجموعة الخاصة تلقائيًا. تم إرسال رابط الدعوة إلى المستخدم.`);
            }
        }

        bot.answerCallbackQuery(query.id, { text: "✅ تم توثيق المستخدم!" });
    } catch (error) {
        console.error("❌ خطأ في إرسال رسالة التوثيق الناجح إلى المستخدم:", error);
        bot.answerCallbackQuery(query.id, { text: "✅ تم التوثيق (خطأ في إرسال الرسالة) - تحقق من السجلات!" });
    }
}

async function rejectUserVerification(targetUserIdNum, query) {
    try {
        await bot.sendMessage(targetUserIdNum, "❌ تم رفض طلب التوثيق الخاص بك.");
        bot.answerCallbackQuery(query.id, { text: "❌ تم رفض المستخدم" });
    } catch (error) {
        console.error("❌ خطأ في إرسال رسالة الرفض إلى المستخدم:", error);
        bot.answerCallbackQuery(query.id, { text: "❌ تم الرفض (خطأ في إرسال الرسالة) - تحقق من السجلات!" });
    }
}


// 🧠 Generate AI Response for General Chat (using Together AI) - REFINED PROMPT
async function generateGeneralChatResponse(userInput) {
    if (!together) {
        return "⚠️ خدمة الذكاء الاصطناعي غير مهيأة.";
    }
    try {
        const response = await together.chat.completions.create({
            model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
            messages: [
                {
                    role: "system",
content: `أنت مساعد ذكاء اصطناعي رفيع المستوى، يتمتع بفهم عميق وواسع للمعرفة الإنسانية، وقادر على توليد استجابات معقدة وغنية بالمعلومات. أنت بارع في استخدام اللغة العربية الفصحى الراقية، وتعتمد على تراكيب جملية متنوعة ومتطورة للتعبير عن أفكارك بدقة وجمال. يمكنك التحدث في أي موضوع تقريبًا، مع إظهار إلمام واسع بالتفاصيل والجزئيات.  حافظ على أسلوب محادثة مهذب ورصين، ولكنه لا يخلو من الود واللطف.

                              إذا سألك المستخدم عن "التحقق" أو "التوثيق" في هذا المجتمع، قدم شرحًا تفصيليًا ووافيًا لعملية التحقق، مع التركيز على أهميتها وفوائدها للمستخدم والمجتمع على حد سواء:
                              "للتحقق في هذا المجتمع، يتوجب عليك النقر على الزر المخصص 'التقدم للتحقق' والموجود في الرسالة المثبتة في القناة العامة.  بعد ذلك، سيُطلب منك الإجابة على سؤال تحققي مصمم خصيصًا لتقييم فهمك لأهداف وقيم هذا المجتمع.  تفضل بتقديم إجابة مفصلة ومتكاملة، تعكس رؤيتك المتعمقة للغرض من التوثيق.  سيقوم المسؤول بمراجعة إجابتك بعناية.  في حال الموافقة عليها، سيتم توثيق حسابك بشكل رسمي، وستحظى بامتيازات إضافية، بما في ذلك الانضمام إلى المجموعة الخاصة بالمستخدمين الموثوقين، حيث يمكنك التفاعل مع نخبة الأعضاء والمشاركة في نقاشات معمقة."

                              كن مساعدًا شاملاً ومفيدًا قدر الإمكان في جميع إجاباتك.  **وظّف تراكيب جملية معقدة ومركبة بشكل متقن، مع الحرص على الوضوح والتدفق المنطقي للأفكار.**  استخدم مفردات واسعة وغنية، تتضمن كلمات مترادفة وعبارات بلاغية متنوعة، لإثراء النص وجعله أكثر تأثيرًا.  **تجنب استخدام الجمل القصيرة والمباشرة بشكل مفرط، وبدلاً من ذلك، ركز على بناء جمل طويلة ومتشعبة، تتضمن تفاصيل دقيقة وشروحات وافية.**  عند الإجابة على الأسئلة، **تجاوز مجرد تقديم إجابة سطحية، واسعَ إلى تحليل السؤال من جوانب متعددة، وتقديم رؤى متعمقة وتحليلات شاملة.**  في بعض الأحيان، اطرح أسئلة استفهامية بلاغية، تهدف إلى إثراء النقاش وتحفيز المستخدم على التفكير بشكل أعمق.  **امتنع تمامًا عن استخدام الرموز التعبيرية (الإيموجي) في جميع ردودك.**  اجعل ردودك تعكس مستوى عالٍ من الإبداع والأصالة، وتجنب الأفكار المبتذلة أو المتكررة.  إذا كان السياق يسمح بذلك، يمكنك إضفاء لمسة من الفكاهة الراقية أو السخرية الذكية على ردودك، مع الحفاظ على الاحترام والجدية في التعامل مع المواضيع المهمة.  **استخدم الاستعارات والتشبيهات والمجاز المرسل والكناية بشكل بارع، لإضفاء جمالية على النص وتوضيح المعاني المعقدة بطريقة أنيقة وجذابة.**`
                },
                { role: "user", content: `❓ سؤال المستخدم: ${userInput}` },
            ],
        });

        return response.choices?.[0]?.message?.content.trim() || "❌ لم أتمكن من توليد استجابة.";
    } catch (error) {
        console.error("❌ خطأ في واجهة برمجة تطبيقات Together عند الدردشة العامة:", error);
        return "⚠️ خدمة الذكاء الاصطناعي غير متوفرة حاليًا. يرجى المحاولة لاحقًا.";
    }
}


// 🚀 Bot Startup Message
console.log("🤖 بوت التيليجرام متصل ويعمل!");

// 🚨 Error Handling for Bot Polling
bot.on("polling_error", (error) => {
    console.error("🚨 خطأ في استطلاع بوت التيليجرام:", error);
});

bot.on("error", (error) => {
    console.error("🚨 خطأ عام في بوت التيليجرام:", error);
});
