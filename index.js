const fs = require('fs');
const path = require('path');
const readline = require('readline');
const chalk = require('chalk');
const figlet = require('figlet');
const { startupPassword } = require('./nexstore/token');

/* ── MERGED MASTER FIX BOOT (v33) — ALL fix packs now load from ONE file.
   See MUST-READ-NO-NEW-FIX-PACKS.md. Never add fix logic here; new fixes go
   into precious-master-fix-boot.cjs (PATCH_CHAIN) or the installAll() of
   precious-all-packs-boot.cjs. The inline patcher chain, the session-fix
   require and the session-boot require that used to live in this spot all
   moved into bootParent(), so `node index.js` can never skip a fix again. ── */
try { require('./precious-master-fix-boot.cjs').bootParent(); }
catch (_eMFB) { console.log('[MASTER-FIX] parent boot FAILED (' + (_eMFB && _eMFB.message) + ')'); }
const _preciousSessionPaths = require('./sessionPaths');
const PAIRING_DIR = _preciousSessionPaths.ensureSessionRoot() + '/';
const pairModule = require('./pair');
const startpairing = typeof pairModule === 'function' ? pairModule : pairModule.startpairing;
if (typeof startpairing !== 'function') throw new Error('Pairing module is not loaded correctly');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function isAuthenticated() {
    return fs.existsSync(AUTH_FILE) && JSON.parse(fs.readFileSync(AUTH_FILE)).authenticated;
}

function setAuthenticated(value) {
    fs.writeFileSync(AUTH_FILE, JSON.stringify({ authenticated: value }));
}

const autoLoadPairs = async () => {
    console.log(chalk.cyan('🔄 Auto-loading all paired users...'));
    
    if (!fs.existsSync(PAIRING_DIR)) {
        console.log(chalk.red('❌ Pairing directory not found.'));
        return;
    }

    const pairedUsers = fs.readdirSync(PAIRING_DIR, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name)
        .filter(name => name.endsWith('@s.whatsapp.net'));

    if (pairedUsers.length === 0) {
        console.log(chalk.yellow('ℹ️  No paired users found.'));
        return;
    }

    console.log(chalk.green(`✅ Found ${pairedUsers.length} paired users. Starting connections...`));
    console.log(chalk.blue('⏳ Waiting 4 seconds before starting connections...'));
    await delay(4000);

    for (let i = 0; i < pairedUsers.length; i++) {
        const userNumber = pairedUsers[i];
        
        try {
            console.log(chalk.blue(`🔄 Connecting user ${i + 1}/${pairedUsers.length}: ${userNumber}`));
            const sessionDir = path.resolve(PAIRING_DIR, userNumber);
            const credsPath = path.join(sessionDir, 'creds.json');
            if (fs.existsSync(credsPath)) {
                const launcher = require('./mais_launcher');
                await launcher.launch(userNumber, sessionDir);
                console.log(chalk.green(`✅ MAIS MDX launched for existing session: ${userNumber}`));
            } else {
                await startpairing(userNumber);
                console.log(chalk.green(`✅ Connected successfully: ${userNumber}`));
            }
            
            if (i < pairedUsers.length - 1) {
                console.log(chalk.blue('⏳ Waiting 4 seconds before next connection...'));
                await delay(4000);
            }
        } catch (error) {
            console.log(chalk.red(`❌ Failed for ${userNumber}: ${error.message}`));
            
            if (i < pairedUsers.length - 1) {
                console.log(chalk.blue('⏳ Waiting 4 seconds before retry...'));
                await delay(4000);
            }
        }
    }

    console.log(chalk.green('✅ All paired users processed.'));
    console.log(chalk.blue('⏳ Waiting 4 seconds before continuing...'));
    await delay(4000);
};

const initializeBot = async () => {
    console.clear();
    console.log(chalk.cyan(figlet.textSync('MAIS MDX BOT', {
        font: 'Standard',
        horizontalLayout: 'default',
        verticalLayout: 'default'
    })));
    
    console.log(chalk.yellow('\n⚄︎══════════════════════⚄︎'));
    console.log(chalk.green('MAIS MDX 2026'));
    console.log(chalk.yellow('⚄︎═════════════════════⚄︎\n'));

    await autoLoadPairs();

    // HEADLESS DEPLOY FIX: on any non-interactive host (Railway, Heroku, Docker,
    // pm2, ...) there is no TTY, so a readline password prompt can never be
    // answered and the bot hangs forever with nothing loaded. Skip the prompt
    // when stdin is not a TTY; the prompt is only kept for local manual runs.
    const HEADLESS = !process.stdin.isTTY;

    if (HEADLESS) {
        console.log(chalk.green('🤖 Headless environment detected — skipping password prompt, starting bot system...'));
        setAuthenticated(true);
        launchBot();
    } else if (isAuthenticated()) {
        console.log(chalk.green('✅ Welcome back! Skipping password...'));
        launchBot();
    } else {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        rl.stdoutMuted = true;
        console.log(chalk.bold.yellow('🔐 Enter password to start bot:'));

        rl.question(chalk.green('Password: '), function (input) {
            if (input !== startupPassword) {
                console.log(chalk.red('\n❌ Incorrect password. Please restart and try again.'));
                rl.close();
                return;
            }

            console.log(chalk.green('\n✅ Password correct. Starting bot system...'));
            setAuthenticated(true);
            rl.close();
            launchBot();
        });

        rl._writeToOutput = function _writeToOutput(stringToWrite) {
            if (rl.stdoutMuted) {
                rl.output.write(chalk.cyan('*'));
            } else {
                rl.output.write(stringToWrite);
            }
        };
    }
};

function launchBot() {
    console.clear();
    console.log(chalk.green('MAIS MDX × TELEXWA is alive....\n'));

    // Telegram pair-bot
    const botPath = path.join(__dirname, 'bot.js');
    let telegramLoaded = false;
    if (fs.existsSync(botPath)) {
        try {
            console.log(chalk.blue('📱 Loading Telegram pairing system...'));
            require('./bot');
            telegramLoaded = true;
            console.log(chalk.green('✅ Telegram bot activated'));
        } catch (error) {
            console.log(chalk.red('❌ Failed to load bot.js:'), error.message);
            if (error.stack) console.log(chalk.gray(error.stack.split('\n').slice(0,3).join('\n')));
        }
    } else {
        console.log(chalk.yellow('⚠️  bot.js not found, skipping Telegram bot...\n'));
    }

    console.log(chalk.cyan('\n⚄︎═══════════════════════════════⚄︎'));
    console.log(chalk.bold.white('  MAIS MDX × TELEXWA SUMMARY        '));
    console.log(chalk.cyan('⚄︎════════════════════════════════⚄︎'));
    console.log(telegramLoaded ? chalk.green('✅ TELEGRAM PAIR-BOT: ACTIVE') : chalk.red('❌ TELEGRAM PAIR-BOT: INACTIVE'));
    console.log(chalk.green('✅ MAIS MDX child-spawn: READY (one process per paired user)'));
    console.log(chalk.cyan('⚄︎════════════════════════════════⚄︎\n'));

    if (!telegramLoaded) {
        console.log(chalk.red('⚠️  Warning: Telegram bot not loaded! Check TELEGRAM_BOT_TOKEN in .env\n'));
    }

    
    // ============ SEND BOT START NOTIFICATION ============
    try {
        const { sendBotStartMessage } = require('./notify');
        setTimeout(async () => {
            await sendBotStartMessage();
            console.log(chalk.green('✓ Startup notification sent to admins'));
        }, 5000);
    } catch (err) {
        console.log(chalk.yellow('⚠️ Could not send startup notification:', err.message));
    }
    // ============ END NOTIFICATION ============

    // Error handlers
    const ignoredErrors = [
        'Socket connection timeout',
        'EKEYTYPE',
        'item-not-found',
        'rate-overlimit',
        'Connection Closed',
        'Timed Out',
        'Value not found',
        // Safety net: a stray writeFile() inside a just-deleted pairing/
        // session dir must NEVER take down the master process and orphan
        // every linked user's WhatsApp child bot.
        'ENOENT',
        'creds.json',
        'nexstore/pairing',
        'use-multi-file-auth-state'
    ];

    process.on('unhandledRejection', (reason, promise) => {
        if (ignoredErrors.some(e => String(reason).includes(e))) return;
        
        console.log(chalk.red('\n⚠️  Unhandled Promise Rejection:'));
        console.log(chalk.yellow('Reason:'), reason);
    });

    process.on('uncaughtException', (error) => {
        if (ignoredErrors.some(e => String(error).includes(e))) return;
        
        console.log(chalk.red('\n❌ Uncaught Exception:'));
        console.log(chalk.yellow('Error:'), error.message);
        if (error.stack) {
            console.log(chalk.gray(error.stack));
        }
    });

    const originalConsoleError = console.error;
    console.error = function (message, ...optionalParams) {
        if (typeof message === 'string' && ignoredErrors.some(e => message.includes(e))) {
            return;
        }
        originalConsoleError.apply(console, [message, ...optionalParams]);
    };

    const originalStderrWrite = process.stderr.write;
    process.stderr.write = function (message, encoding, fd) {
        if (typeof message === 'string' && ignoredErrors.some(e => message.includes(e))) {
            return;
        }
        originalStderrWrite.apply(process.stderr, arguments);
    };

    console.log(chalk.blue('📊 Bot monitoring active...'));
    console.log(chalk.gray('Press Ctrl+C to stop the bot\n'));
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log(chalk.yellow('\n\n⚠️  Shutting down gracefully...'));
    console.log(chalk.green('👋 Goodbye!'));
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log(chalk.yellow('\n\n⚠️  Received termination signal...'));
    process.exit(0);
});

initializeBot().catch((error) => {
    console.log(chalk.red('\n❌ Fatal error during initialization:'));
    console.log(chalk.yellow('Error:'), error.message);
    if (error.stack) {
        console.log(chalk.gray(error.stack));
    }
    process.exit(1);
});
