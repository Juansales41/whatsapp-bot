const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const client = new Client({
    puppeteer: {
        executablePath: process.env.CHROME_PATH, // Carregando de variáveis de ambiente
    },
    authStrategy: new LocalAuth()
});

let userState = {};
const reportFilePath = './atendimentos.csv'; // Alterar conforme necessário

const transporter = nodemailer.createTransport({
    service: 'hotmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

function saveReport(data) {
    const header = 'Chat ID,Nome,Matrícula,Opção,Detalhes,Avaliação,Data,Código,Status\n';
    const row = `${data.chatId},${data.name},${data.matricula},${data.opcao},${data.detalhes},${data.rating},${data.date},${data.code},${data.status}\n`;
    
    if (!fs.existsSync(reportFilePath)) {
        fs.writeFileSync(reportFilePath, header);
    }
    fs.appendFileSync(reportFilePath, row);
}

function sendReportEmail() {
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: process.env.EMAIL_USER,
        subject: 'Relatório de Atendimento',
        text: 'Segue em anexo o relatório de atendimentos.',
        attachments: [{ filename: 'atendimentos.csv', path: reportFilePath }]
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.error('Erro ao enviar e-mail:', error);
        } else {
            console.log('E-mail enviado:', info.response);
        }
    });
}

function generateTicketCode() {
    return `DP${uuidv4().split('-')[0].toUpperCase()}`;
}

function startUserTimer(user) {
    user.timer = setTimeout(async () => {
        await client.sendMessage(user.chatId, '⏳ Parece que você está um pouco ocupado. Estou aqui quando precisar! 😉');
    }, 10 * 60 * 1000);
}

function clearUserTimer(user) {
    if (user.timer) {
        clearTimeout(user.timer);
        user.timer = null;
    }
}

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('QR RECEIVED', qr);
});

client.on('ready', () => {
    console.log('Client is ready!');
});

client.on('message', async (message) => {
    const chatId = message.from;
    const text = message.body.toLowerCase().trim();

    if (message.isGroupMsg) {
        await client.sendMessage(chatId, '🔒 Não posso responder em grupos. Por favor, envie uma mensagem privada.');
        return;
    }

    if (!userState[chatId]) {
        userState[chatId] = { awaitingResponse: 'initial', timer: null };
        await client.sendMessage(chatId, `👋 Olá! Eu sou a IADP 🤖, sua assistente virtual do Departamento Pessoal! Como posso te ajudar hoje?\n\n1️⃣ - Iniciar atendimento\n2️⃣ - Verificar o status de um protocolo`);
        return;
    }

    const user = userState[chatId];
    clearUserTimer(user);

    switch (user.awaitingResponse) {
        case 'initial':
            await handleInitialResponse(user, chatId, text);
            break;
        case 'name':
            await handleNameResponse(user, chatId, text);
            break;
        case 'matricula':
            await handleMatriculaResponse(user, chatId, text);
            break;
        case 'opcao':
            await handleOpcaoResponse(user, chatId, text);
            break;
        case 'detalhes':
            await handleDetalhesResponse(user, chatId, text);
            break;
        case 'rating':
            await handleRatingResponse(user, chatId, text);
            break;
        case 'protocolo':
            await handleProtocoloResponse(user, chatId, text);
            break;
        default:
            await client.sendMessage(chatId, '⚠ Desculpe, não entendi sua mensagem. Por favor, escolha uma das opções:\n1️⃣ - Iniciar atendimento\n2️⃣ - Verificar o status de um protocolo');
    }
});

// Funções para manipular respostas
async function handleInitialResponse(user, chatId, text) {
    if (text === '1') {
        user.awaitingResponse = 'name';
        await client.sendMessage(chatId, '📝 Ótimo! Informe seu nome completo:');
        startUserTimer(user);
    } else if (text === '2') {
        user.awaitingResponse = 'protocolo';
        await client.sendMessage(chatId, '📄 Por favor, informe o número do seu protocolo:');
        startUserTimer(user);
    } else {
        await client.sendMessage(chatId, '⚠ Por favor, escolha uma opção válida: 1️⃣ ou 2️⃣');
    }
}

async function handleNameResponse(user, chatId, text) {
    user.name = text;
    user.awaitingResponse = 'matricula';
    await client.sendMessage(chatId, `📝 Perfeito, ${text.split(' ')[0]}! Agora, informe sua matrícula (6 dígitos e começando com 0):`);
    startUserTimer(user);
}

async function handleMatriculaResponse(user, chatId, text) {
    if (!/^[0]\d{5}$/.test(text)) {
        await client.sendMessage(chatId, '⚠ A matrícula deve ter 6 dígitos e começar com 0. Tente novamente.');
        return;
    }
    user.matricula = text;
    user.awaitingResponse = 'opcao';
    user.code = generateTicketCode();
    await client.sendMessage(chatId, 'Escolha uma das opções:\n1️⃣ Benefícios\n2️⃣ Férias\n3️⃣ Gestão de ponto\n4️⃣ Outros');
    startUserTimer(user);
}

async function handleOpcaoResponse(user, chatId, text) {
    user.opcao = text;
    user.awaitingResponse = 'detalhes';
    await client.sendMessage(chatId, `Você escolheu "${text}". Descreva sua dúvida:`);
    startUserTimer(user);
}

async function handleDetalhesResponse(user, chatId, text) {
    user.detalhes = text;
    user.awaitingResponse = 'rating';
    await client.sendMessage(chatId, '✅ Informação coletada! Avalie nosso atendimento de 1 a 5:');
    startUserTimer(user);
}

async function handleRatingResponse(user, chatId, text) {
    const rating = parseInt(text);
    if (rating < 1 || rating > 5) {
        await client.sendMessage(chatId, '⚠ A avaliação deve ser entre 1 e 5. Tente novamente.');
        return;
    }
    user.rating = rating;
    user.awaitingResponse = null;
    user.status = 'Concluído';

    const reportData = {
        chatId: user.chatId,
        name: user.name,
        matricula: user.matricula,
        opcao: user.opcao,
        detalhes: user.detalhes,
        rating: user.rating,
        date: new Date().toISOString(),
        code: user.code,
        status: user.status
    };

    saveReport(reportData);
    await client.sendMessage(chatId, `✅🎉 Atendimento concluído! Detalhes:\n\nNome: ${user.name}\nMatrícula: ${user.matricula}\nOpção: ${user.opcao}\nDetalhes: ${user.detalhes}\nAvaliação: ${user.rating}\nCódigo do atendimento: ${user.code}`);
    sendReportEmail();
    userState[chatId] = null;
}

async function handleProtocoloResponse(user, chatId, text) {
    // Implementar lógica para buscar e exibir o status do protocolo
}

// Inicializar o cliente
client.initialize();
