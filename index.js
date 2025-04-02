require("dotenv").config();
const fs = require("fs");
const TelegramBot = require("node-telegram-bot-api");
const { Together } = require("together-ai");

// ⚙️ Configuration & Setup
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TOGETHER_AI_API_KEY = process.env.TOGETHER_AI_API_KEY;
const ADMIN_ID = Number(process.env.ADMIN_ID);
const PUBLIC_CHANNEL_ID = Number(process.env.PUBLIC_CHANNEL_ID);
const RESTRICTED_TOPIC_ID = Number(process.env.RESTRICTED_TOPIC_ID) || null; // Default to null if not a valid number or missing
const PRIVATE_GROUP_ID = process.env.PRIVATE_GROUP_ID;
const PRIVATE_GROUP_INVITE_LINK = process.env.PRIVATE_GROUP_INVITE_LINK || "https://t.me/+zgS8UCh32NUwMTc0"; // Default invite link if not set
const BOT_USERNAME = process.env.BOT_USERNAME; // Bot's username WITHOUT the '@'

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

    if (process.env.RESTRICTED_TOPIC_ID && isNaN(RESTRICTED_TOPIC_ID)) { // Check if env var is present but not a number
        console.warn("⚠️ Environment variable RESTRICTED_TOPIC_ID is not a valid number. Topic restriction will be disabled.");
    } else if (!process.env.RESTRICTED_TOPIC_ID) { // Check if env var is missing entirely
         console.log("ℹ️ Environment variable RESTRICTED_TOPIC_ID is missing. Topic restriction is disabled.");
    }


    if (!PRIVATE_GROUP_ID) {
        console.warn("⚠️ Environment variable PRIVATE_GROUP_ID is missing. Auto-join to private group after verification will be disabled.");
    }

    if (!BOT_USERNAME) {
        console.error("❌ Environment variable BOT_USERNAME is missing. Please set your Telegram Bot Username (without @). This is required for the /sendverify command.");
        process.exit(1);
    }
}

validateEnvironmentVariables();

// ✅ Initialize Telegram Bot & Together AI (conditional)
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const together = TOGETHER_AI_API_KEY ? new Together({ apiKey: TOGETHER_AI_API_KEY }) : null;

// 🗂️ Data Storage & Loading (Improved Error Handling)
const BOT_DATA_FILE = "data.json"; // Note: This file isn't actively used in the current logic besides loading defaults
const VERIFIED_USERS_FILE = "verified_users.json";
const LAST_VERIFICATION_MESSAGE_FILE = "last_verification_message.json";

let botData = loadBotData(); // Currently just loads default reference text if file is missing/corrupt
let verifiedUsers = loadVerifiedUsers();
let lastVerificationMessage = loadLastVerificationMessage();

function loadBotData() {
    try {
        if (fs.existsSync(BOT_DATA_FILE)) {
            const rawData = fs.readFileSync(BOT_DATA_FILE, "utf8");
            return JSON.parse(rawData);
        } else {
            console.warn(`⚠️ Warning: ${BOT_DATA_FILE} not found. Using default data.`);
             // Provide default structure if file doesn't exist
            return { verification_keywords: [], verification_reference: "⚠️ بيانات التوثيق غير متاحة. الرجاء التحقق من ملف data.json." };
        }
    } catch (error) {
        console.error(`❌ Error loading or parsing ${BOT_DATA_FILE}:`, error);
        // Fallback to default data on error
        return { verification_keywords: [], verification_reference: "⚠️ بيانات التوثيق غير متاحة بسبب خطأ في التحميل." };
    }
}


function loadVerifiedUsers() {
    try {
        if (fs.existsSync(VERIFIED_USERS_FILE)) {
            const rawData = fs.readFileSync(VERIFIED_USERS_FILE, "utf8");
            return JSON.parse(rawData);
        } else {
            console.warn(`⚠️ Warning: ${VERIFIED_USERS_FILE} not found. Starting with empty verified users list.`);
            return {};
        }
    } catch (error) {
        console.warn(`⚠️ Warning: Error loading or parsing ${VERIFIED_USERS_FILE}. Starting with empty verified users list.`, error);
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
        if (fs.existsSync(LAST_VERIFICATION_MESSAGE_FILE)) {
            const rawData = fs.readFileSync(LAST_VERIFICATION_MESSAGE_FILE, "utf8");
            return JSON.parse(rawData);
        } else {
            console.warn(`⚠️ Warning: ${LAST_VERIFICATION_MESSAGE_FILE} not found. Starting without tracking last verification message.`);
             return { messageId: null };
        }
    } catch (error) {
       console.warn(`⚠️ Warning: Error loading or parsing ${LAST_VERIFICATION_MESSAGE_FILE}. Starting without tracking last verification message.`, error);
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
const verificationSessions = {}; // Stores { userId: { question: "..." } }
const pendingApprovals = {}; // Stores { userId: { question: "...", answer: "..." } }

// 🚫 Message Restriction in Specific Topic
async function handleRestrictedTopicMessage(msg) {
    // Exit if restriction is not configured or message is not in a topic
    if (!RESTRICTED_TOPIC_ID || !msg.is_topic_message || !msg.message_thread_id) return;

    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const topicId = msg.message_thread_id;

    // Check if the message is in the restricted topic and not from the admin
    if (topicId === RESTRICTED_TOPIC_ID && userId !== ADMIN_ID) {
        try {
            await bot.deleteMessage(chatId, msg.message_id);
            console.log(`🗑️ Deleted message from user ${userId} (ID: ${msg.from.id}) in restricted topic ${RESTRICTED_TOPIC_ID} of chat ${chatId}.`);
        } catch (error) {
            console.error(`❌ Error deleting message in restricted topic (Chat: ${chatId}, Topic: ${topicId}, Msg ID: ${msg.message_id}):`, error.response?.body || error.message);
        }
    }
}


// --- Command Handlers ---

// /chat command handler
async function handleChatCommand(msg, args) {
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
}

// /sendverify command handler
async function handleSendVerifyCommand(msg) {
    const userId = msg.from.id;

    if (userId !== ADMIN_ID) {
        bot.sendMessage(userId, "❌ هذا الأمر مخصص فقط للمسؤول.");
        return;
    }

    // Ensure BOT_USERNAME is available (already validated at startup, but good practice)
    if (!BOT_USERNAME) {
         bot.sendMessage(ADMIN_ID, "❌ لا يمكن إرسال رسالة التحقق. BOT_USERNAME غير معرف.");
         console.error("❌ Cannot execute /sendverify: BOT_USERNAME is missing.");
         return;
    }

    const verificationText = "📢 هل ترغب في التقدم للتحقق؟ اضغط على الزر أدناه لبدء العملية عبر التحدث للبوت.";
    const verificationKeyboard = {
        reply_markup: {
            // **CHANGE:** Use a URL button to link directly to the bot's chat with /start command
            inline_keyboard: [[{ text: "➡️ بدء التحقق (/start)", url: `https://t.me/${BOT_USERNAME}?start=verify` }]] // Added '=verify' payload for potential future use, but just '?start' works too.
        }
    };

    try {
        let messageSentOrUpdated = false;
        // Try editing the last known message first
        if (lastVerificationMessage.messageId) {
            try {
                await bot.editMessageText(verificationText, {
                    chat_id: PUBLIC_CHANNEL_ID,
                    message_id: lastVerificationMessage.messageId,
                    ...verificationKeyboard // Includes reply_markup
                });
                console.log(`✅ تم تحديث رسالة التحقق (ID: ${lastVerificationMessage.messageId}) في القناة ${PUBLIC_CHANNEL_ID}`);
                bot.sendMessage(userId, "✅ تم تحديث رسالة التحقق بنجاح!");
                messageSentOrUpdated = true;
            } catch (editError) {
                console.warn(`⚠️ فشل تحديث رسالة التحقق (ID: ${lastVerificationMessage.messageId}). السبب: ${editError.response?.body?.description || editError.message}. سيتم محاولة إرسال رسالة جديدة.`);
                 if (editError.response && editError.response.statusCode === 400 && editError.response.body?.description?.includes("message to edit not found")) {
                     console.warn("   - الرسالة السابقة لم يتم العثور عليها (ربما تم حذفها).");
                     lastVerificationMessage.messageId = null; // Reset messageId since it's invalid
                     saveLastVerificationMessage(null);
                 } else if (editError.response && editError.response.statusCode === 403) {
                     console.error("   🚨 خطأ 403 (Forbidden): تأكد من أن البوت لديه صلاحيات *تعديل* الرسائل في القناة.");
                 }
            }
        }

        // If editing failed or no previous message existed, send a new one
        if (!messageSentOrUpdated) {
            const message = await bot.sendMessage(PUBLIC_CHANNEL_ID, verificationText, verificationKeyboard);
            lastVerificationMessage.messageId = message.message_id;
            saveLastVerificationMessage(message.message_id);
            console.log(`✅ تم إرسال رسالة تحقق جديدة (ID: ${message.message_id}) إلى القناة ${PUBLIC_CHANNEL_ID}`);
            bot.sendMessage(userId, "✅ تم إرسال رسالة التحقق بنجاح!");
        }

    } catch (error) {
        console.error("❌ خطأ فادح في إرسال أو تحديث رسالة التحقق:", error.response?.body || error.message);
        if (error.response && error.response.statusCode === 403) {
            console.error("🚨 خطأ 403 (Forbidden): تأكد من أن البوت لديه صلاحيات *إرسال* الرسائل في القناة.");
        }
        bot.sendMessage(userId, "❌ فشل فادح في إرسال/تحديث رسالة التحقق. تحقق من السجلات وصلاحيات البوت في القناة.");
    }
}

// /start command handler (specifically for verification initiation)
async function handleStartCommandForVerification(msg) {
    const userId = msg.from.id;

    // Prevent starting if already verified
    if (verifiedUsers[userId]) {
        bot.sendMessage(userId, "✅ أنت بالفعل مستخدم موثق.");
        return;
    }

    // Prevent starting if already in a verification process
     if (verificationSessions[userId] || pendingApprovals[userId]) {
        bot.sendMessage(userId, "⏳ أنت بالفعل في عملية تحقق أو تنتظر الموافقة.");
        return;
    }

    // --- Start Verification ---
    const verificationQuestion = "ما هو الغرض من التحقق في هذا المجتمع؟"; // Static Arabic Verification Question
    verificationSessions[userId] = { question: verificationQuestion };

    try {
        await bot.sendMessage(userId, `📝 **سؤال التحقق:**\n${verificationQuestion}\n\n💡 **يرجى إرسال إجابتك الآن كرسالة نصية.**`, { parse_mode: "Markdown" });
        console.log(`🚀 Started verification process for user ${userId}`);
    } catch (error) {
        console.error(`❌ خطأ في إرسال سؤال التحقق إلى المستخدم ${userId}:`, error.response?.body || error.message);
        bot.sendMessage(userId, "❌ فشل بدء عملية التحقق. يرجى المحاولة مرة أخرى لاحقًا أو الاتصال بالمسؤول.");
        delete verificationSessions[userId]; // Clean up session if sending failed
    }
}


// --- Main Message Listener ---
bot.on("message", async (msg) => {
    // 1. Handle Topic Restriction First (if applicable)
    await handleRestrictedTopicMessage(msg);

    // Ignore messages without text or from bots
    if (!msg.text || msg.from.is_bot) return;

    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const userInput = msg.text.trim();
    const isPrivateChat = msg.chat.type === 'private';

    // 2. Handle AI Chat on Reply (in any chat)
    if (msg.reply_to_message && !userInput.startsWith('/')) { // Respond to replies unless it's clearly a command
        if (!together) {
            // Optionally inform user AI is disabled, or just do nothing
            // bot.sendMessage(chatId, "⚠️ ميزة الرد بالذكاء الاصطناعي معطلة.", { reply_to_message_id: msg.message_id });
            console.log("🤖 AI reply skipped (AI disabled).");
            return;
        }
        bot.sendChatAction(chatId, 'typing'); // Show typing indicator
        try {
            const responseText = await generateGeneralChatResponse(userInput);
            bot.sendMessage(chatId, responseText, { reply_to_message_id: msg.message_id });
        } catch (apiError) {
            console.error("❌ خطأ في توليد استجابة الذكاء الاصطناعي عند الرد:", apiError);
            bot.sendMessage(chatId, "⚠️ خدمة الذكاء الاصطناعي غير متوفرة حاليًا. يرجى المحاولة لاحقًا.", { reply_to_message_id: msg.message_id });
        }
        return; // Don't process further if it was an AI reply
    }

    // 3. Handle Verification Answer (Only in Private Chat)
    if (isPrivateChat && verificationSessions[userId]) {
        const sessionData = verificationSessions[userId];
        pendingApprovals[userId] = { question: sessionData.question, answer: userInput };
        delete verificationSessions[userId]; // Move from active session to pending

        try {
            await sendVerificationAnswerToAdmin(msg, userInput, sessionData.question);
            await bot.sendMessage(userId, "⏳ تم إرسال إجابتك إلى المسؤول للمراجعة. سيتم إعلامك بالنتيجة.");
            console.log(`✅ Received verification answer from user ${userId}. Sent to admin.`);
        } catch (error) {
            console.error(`❌ Error handling verification answer for user ${userId} or sending admin message:`, error);
            bot.sendMessage(userId, "❌ حدث خطأ أثناء معالجة إجابتك. يرجى محاولة بدء التحقق مرة أخرى باستخدام /start.");
            // Clean up pending approval if admin message failed potentially
             if (pendingApprovals[userId]) delete pendingApprovals[userId];
        }
        return; // Answer processed, stop further checks
    }

    // 4. Handle Commands (mainly in Private Chat or by Admin)
    if (userInput.startsWith("/")) {
        const commandParts = userInput.split(" ");
        const commandName = commandParts[0].substring(1).toLowerCase();
        const args = commandParts.slice(1);

        switch (commandName) {
            case "start":
                if (isPrivateChat) {
                    await handleStartCommandForVerification(msg);
                } else {
                     // Optional: Inform user to use /start in private chat
                     // bot.sendMessage(chatId, "يرجى استخدام الأمر /start في محادثة خاصة معي لبدء التحقق.", { reply_to_message_id: msg.message_id });
                }
                break;
            case "chat":
                // Allow /chat anywhere for simplicity, or restrict to private chat: if (isPrivateChat) { ... }
                await handleChatCommand(msg, args);
                break;
            case "sendverify":
                 // This command is admin-only anyway, location doesn't strictly matter
                 await handleSendVerifyCommand(msg);
                 break;
            // Add other command cases here if needed
            // default:
            //     if (isPrivateChat) {
            //          bot.sendMessage(userId, "❌ أمر غير معروف.");
            //     }
        }
        return; // Command processed
    }

    // 5. Optional: Handle general messages to the bot in private chat (e.g., default AI chat)
    if (isPrivateChat && together) {
        bot.sendChatAction(chatId, 'typing');
         try {
            const responseText = await generateGeneralChatResponse(userInput);
            bot.sendMessage(userId, responseText);
        } catch (apiError) {
            console.error("❌ خطأ في توليد استجابة الذكاء الاصطناعي للمحادثة العامة:", apiError);
            bot.sendMessage(userId, "⚠️ خدمة الذكاء الاصطناعي غير متوفرة حاليًا. يرجى المحاولة لاحقًا.");
        }
         return;
    }

});

// --- Helper Functions for Verification Flow ---

async function sendVerificationAnswerToAdmin(userMsg, userAnswer, question) {
    const userId = userMsg.from.id;
    const firstName = userMsg.from.first_name;
    const username = userMsg.from.username ? `@${userMsg.from.username}` : '(لا يوجد)';

    const adminMessage = `🔔 **طلب تحقق جديد!**
👤 المستخدم: ${firstName} (${username}) (ID: ${userId})

📝 **سؤال التحقق:**
${question}

✍️ **إجابة المستخدم:**
${userAnswer}`;

    const adminKeyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: "✅ قبول", callback_data: `approve_${userId}` }],
                [{ text: "❌ رفض", callback_data: `reject_${userId}` }]
            ]
        }
    };

    try {
        await bot.sendMessage(ADMIN_ID, adminMessage, { parse_mode: "Markdown", ...adminKeyboard });
    } catch (error) {
        console.error(`❌ Error sending verification details for user ${userId} to admin ${ADMIN_ID}:`, error.response?.body || error.message);
        // Rethrow the error so the calling function knows it failed
        throw new Error(`Failed to send verification to admin: ${error.message}`);
    }
}

// --- Callback Query Handler (Admin Buttons) ---
bot.on("callback_query", async (query) => {
    const adminUserId = query.from.id;
    const data = query.data;
    const message = query.message; // Message the buttons are attached to

    // Ensure it's the admin clicking the button
    if (adminUserId !== ADMIN_ID) {
        await bot.answerCallbackQuery(query.id, { text: "❌ هذا الإجراء للمسؤول فقط!" });
        return;
    }

    if (data.startsWith("approve_") || data.startsWith("reject_")) {
        const [action, targetUserIdStr] = data.split("_");
        const targetUserIdNum = Number(targetUserIdStr);

        if (isNaN(targetUserIdNum)) {
             console.error(`❌ Invalid targetUserId in callback data: ${data}`);
             await bot.answerCallbackQuery(query.id, { text: "⚠️ خطأ: معرّف المستخدم غير صالح." });
             return;
        }

        // Check if the approval request still exists
        if (!pendingApprovals[targetUserIdNum]) {
            await bot.answerCallbackQuery(query.id, { text: "⚠️ الطلب تمت معالجته بالفعل أو انتهت صلاحيته." });
             // Optionally edit the admin message to indicate it's processed
             try {
                 await bot.editMessageText(message.text + "\n\n---\n✅ (تمت المعالجة)", {
                     chat_id: message.chat.id,
                     message_id: message.message_id,
                     parse_mode: "Markdown" // Keep formatting
                 });
             } catch (editError) {
                 console.warn(`⚠️ Could not edit admin message after processing callback ${query.id}:`, editError.message);
             }
            return;
        }

        // Process Approval or Rejection
        let resultText = "";
        if (action === "approve") {
            resultText = await approveUserVerification(targetUserIdNum, query);
        } else if (action === "reject") {
            resultText = await rejectUserVerification(targetUserIdNum, query);
        }

        // Remove from pending list *after* processing
        delete pendingApprovals[targetUserIdNum];

         // Edit the original admin message to show the action taken
        try {
            await bot.editMessageText(message.text + `\n\n---\n**النتيجة: ${resultText}** (بواسطة ${query.from.first_name})`, {
                chat_id: message.chat.id,
                message_id: message.message_id,
                parse_mode: "Markdown" // Keep formatting
            });
        } catch (editError) {
            console.warn(`⚠️ Could not edit admin message after completing callback ${query.id}:`, editError.message);
        }

    } else {
        // Handle other potential callback data if needed
        await bot.answerCallbackQuery(query.id); // Acknowledge other callbacks silently
    }
});


async function approveUserVerification(targetUserIdNum, query) {
    verifiedUsers[targetUserIdNum] = true; // Mark as verified
    saveVerifiedUsers(verifiedUsers); // Save the updated list
    let adminFeedback = "✅ تم قبول المستخدم";

    try {
        await bot.sendMessage(targetUserIdNum, "🎉 تهانينا! تم توثيق حسابك بنجاح في مجتمعنا.");
        console.log(`✅ User ${targetUserIdNum} approved by admin ${query.from.id}`);

        // Attempt to add to the private group if configured
        if (PRIVATE_GROUP_ID) {
            try {
                // Use createChatInviteLink for better robustness if adding directly fails often
                // Or attempt direct add:
                 // await bot.unbanChatMember(PRIVATE_GROUP_ID, targetUserIdNum); // Ensure not banned if re-verifying
                 // await bot.approveChatJoinRequest(PRIVATE_GROUP_ID, targetUserIdNum); // If using join requests
                 // For direct add (less common for private groups without invite links):
                 // await bot.addChatMember(PRIVATE_GROUP_ID, targetUserIdNum); // Might require specific bot permissions

                 // Sending invite link is usually the most reliable for private groups
                await bot.sendMessage(targetUserIdNum, `✅ يمكنك الآن الانضمام إلى مجموعتنا الخاصة بالمستخدمين الموثقين عبر الرابط: ${PRIVATE_GROUP_INVITE_LINK}`);
                console.log(`🔗 Sent private group invite link to approved user ${targetUserIdNum}.`);
                adminFeedback += " (تم إرسال رابط الدعوة)";

            } catch (groupError) {
                console.error(`❌ Error sending invite link or managing user ${targetUserIdNum} in private group ${PRIVATE_GROUP_ID}:`, groupError.response?.body || groupError.message);
                 if (groupError.response?.statusCode === 400 && groupError.response?.body?.description?.includes('USER_ALREADY_PARTICIPANT')) {
                    console.log(`   - User ${targetUserIdNum} is already in the private group.`);
                    await bot.sendMessage(targetUserIdNum, "👍 لاحظنا أنك عضو بالفعل في المجموعة الخاصة."); // Inform user
                    adminFeedback += " (موجود بالفعل بالمجموعة)";
                } else {
                    await bot.sendMessage(targetUserIdNum, `⚠️ تم توثيقك، ولكن حدث خطأ أثناء إرسال رابط المجموعة الخاصة. يرجى محاولة الانضمام يدويًا: ${PRIVATE_GROUP_INVITE_LINK} أو الاتصال بالمسؤول إذا استمرت المشكلة.`);
                    await bot.sendMessage(ADMIN_ID, `⚠️ فشل إرسال رابط الدعوة للمستخدم ${targetUserIdNum} (${targetUserIdNum}). قد يكون بحاجة للمساعدة اليدوية للانضمام للمجموعة الخاصة.`);
                    adminFeedback += " (فشل إرسال الرابط)";
                }
            }
        }
        await bot.answerCallbackQuery(query.id, { text: "✅ تم التوثيق بنجاح!" });

    } catch (error) {
        console.error(`❌ خطأ في إرسال رسالة التوثيق الناجح للمستخدم ${targetUserIdNum}:`, error.response?.body || error.message);
        // Even if message fails, user is marked verified. Inform admin.
        await bot.answerCallbackQuery(query.id, { text: "✅ تم التوثيق (خطأ في إرسال رسالة للمستخدم)" });
        adminFeedback += " (خطأ بإرسال رسالة للمستخدم)";
    }
    return adminFeedback; // Return text for admin message update
}

async function rejectUserVerification(targetUserIdNum, query) {
    let adminFeedback = "❌ تم رفض المستخدم";
    try {
        await bot.sendMessage(targetUserIdNum, "❌ نأسف، لم يتم قبول طلب التوثيق الخاص بك في الوقت الحالي. يمكنك محاولة إعادة التقديم لاحقًا إذا رغبت.");
        console.log(`❌ User ${targetUserIdNum} rejected by admin ${query.from.id}`);
        await bot.answerCallbackQuery(query.id, { text: "❌ تم رفض المستخدم." });
    } catch (error) {
        console.error(`❌ خطأ في إرسال رسالة الرفض للمستخدم ${targetUserIdNum}:`, error.response?.body || error.message);
        await bot.answerCallbackQuery(query.id, { text: "❌ تم الرفض (خطأ في إرسال رسالة للمستخدم)" });
        adminFeedback += " (خطأ بإرسال رسالة للمستخدم)";
    }
     return adminFeedback; // Return text for admin message update
}


// 🧠 Generate AI Response for General Chat (using Together AI) - REFINED PROMPT
async function generateGeneralChatResponse(userInput) {
    if (!together) {
        // Return a default non-AI message instead of throwing an error upstream
        return "⚠️ خدمة الذكاء الاصطناعي غير مهيأة حاليًا.";
    }
    try {
        console.log(`🧠 Generating AI response for: "${userInput}"`);
        const response = await together.chat.completions.create({
            model: "meta-llama/Llama-3.3-70B-Instruct-Turbo", // Or your preferred model
            messages: [
                 {
                    role: "system",
                    content: `أنت مساعد ذكاء اصطناعي متقدم، يتمتع بفهم واسع للمعلومات وقادر على توليد استجابات مفصلة وغنية بالمعلومات باللغة العربية الفصحى. أسلوبك راقٍ ومهذب، مع توظيف تراكيب جملية متنوعة للتعبير عن أفكارك بوضوح ودقة. تجنب استخدام الرموز التعبيرية.

إذا سُئلت عن "التحقق" أو "التوثيق"، اشرح العملية بوضوح: "لبدء عملية التحقق، يرجى الضغط على الزر الموجود في رسالة القناة العامة أو إرسال الأمر /start مباشرة لي في هذه المحادثة الخاصة. سيُطرح عليك سؤال لتقييم فهمك لأهداف المجتمع. بعد إرسال إجابتك، سيراجعها المسؤول. عند الموافقة، سيتم توثيق حسابك وإرسال رابط للانضمام إلى المجموعة الخاصة."

كن مساعدًا شاملاً ومفيدًا. قدم إجابات واضحة ومفصلة، وركز على تقديم معلومات قيمة وتحليل موجز. عند الضرورة، اطرح أسئلة ذات صلة لتوسيع الحوار. حافظ على الأصالة وحاول تقديم أفكار مبتكرة.`
                },
                { role: "user", content: userInput }, // Keep user input clean
            ],
             max_tokens: 512, // Limit response length if needed
             temperature: 0.7, // Adjust creativity vs factualness
        });

        const result = response.choices?.[0]?.message?.content?.trim();
        console.log(`💡 AI Response generated.`);
        return result || "❌ لم أتمكن من توليد استجابة. حاول مرة أخرى.";

    } catch (error) {
        console.error("❌ خطأ في واجهة برمجة تطبيقات Together عند الدردشة العامة:", error.response?.data || error.message);
        // Provide a user-friendly error message
        return "⚠️ عذرًا، خدمة الذكاء الاصطناعي تواجه مشكلة مؤقتة. يرجى المحاولة لاحقًا.";
    }
}


// --- Bot Startup and Error Handling ---
console.log("🚀 Starting Telegram Bot...");

bot.getMe().then((botInfo) => {
     console.log(`✅ Bot Connected! Username: @${botInfo.username} (ID: ${botInfo.id})`);
     // Check if configured BOT_USERNAME matches actual username
     if (BOT_USERNAME && botInfo.username !== BOT_USERNAME) {
         console.warn(`⚠️ Mismatch: Configured BOT_USERNAME ('${BOT_USERNAME}') does not match actual bot username ('${botInfo.username}'). Please update .env file.`);
     } else if (!BOT_USERNAME) {
         // If BOT_USERNAME was missing, we can now inform the user what it is, but it's critical it's set in .env for /sendverify
         console.error(`‼️ FATAL: BOT_USERNAME is not set in the environment variables, but the bot's username is '${botInfo.username}'. Please set BOT_USERNAME=${botInfo.username} in your .env file and restart.`);
         process.exit(1); // Exit because /sendverify relies on this
     }
}).catch(err => {
    console.error("❌ Failed to get bot info:", err.message);
     console.error("   - Check your BOT_TOKEN and network connection.");
     process.exit(1);
});


// Global error handlers
bot.on("polling_error", (error) => {
    console.error(`🚨 Polling Error: ${error.code} - ${error.message}`);
    // Common errors: ECONNRESET, ETIMEDOUT, ENOTFOUND
    // Consider adding logic here to maybe pause polling or notify admin on repeated critical errors.
});

bot.on("webhook_error", (error) => {
    console.error(`🚨 Webhook Error: ${error.code} - ${error.message}`);
    // If using webhooks instead of polling
});

bot.on("error", (error) => {
    console.error("🚨 General Bot Error:", error);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log("\n🚦 SIGINT received. Shutting down bot gracefully...");
  bot.stopPolling().then(() => {
      console.log("🛑 Bot polling stopped.");
      process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log("\n🚦 SIGTERM received. Shutting down bot gracefully...");
  bot.stopPolling().then(() => {
      console.log("🛑 Bot polling stopped.");
      process.exit(0);
  });
});
