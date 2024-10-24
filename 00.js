import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;

import qrcode from 'qrcode-terminal';
import nodemailer from 'nodemailer';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import fs from 'fs';
import axios from 'axios'; // Para integração com APIs externas
import express from 'express'; // Para o painel de administração

// Carrega as variáveis de ambiente
dotenv.config();

// Caminho do arquivo de estado do usuário
const userStateFilePath = './userState.json';

// Carrega ou inicializa o estado dos usuários
let userState = {};
if (fs.existsSync(userStateFilePath)) {
    userState = JSON.parse(fs.readFileSync(userStateFilePath));
} else {
    fs.writeFileSync(userStateFilePath, JSON.stringify({}));
}

// Salva o estado dos usuários no arquivo com tratamento de erro
function saveUserState() {
    try {
        fs.writeFileSync(userStateFilePath, JSON.stringify(userState, null, 2));
    } catch (error) {
        console.error('Erro ao salvar o estado do usuário:', error);
    }
}

// Configurações do cliente do WhatsApp
const client = new Client({
    puppeteer: {
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    },
    authStrategy: new LocalAuth(),
});

// Variáveis globais
const reportFilePath = './atendimentos.csv';
const supportedLanguages = ['pt', 'en']; // Idiomas suportados
let protocolNumber = 0; // Número do protocolo global

// Configuração do transportador de e-mail para Outlook
const transporter = nodemailer.createTransport({
    host: 'smtp.office365.com',
    port: 587,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

// Função para obter saudação com base na hora do dia e idioma
function getGreeting(language = 'pt') {
    const hour = new Date().getHours();
    let greeting = {
        pt: { morning: 'Bom dia', afternoon: 'Boa tarde', night: 'Boa noite' },
        en: { morning: 'Good morning', afternoon: 'Good afternoon', night: 'Good evening' }
    };
    if (hour < 12) {
        return greeting[language].morning;
    } else if (hour < 18) {
        return greeting[language].afternoon;
    } else {
        return greeting[language].night;
    }
}

// Função para salvar relatório
function saveReport(data) {
    const header =
        'Chat ID,Nome,Matrícula,Opção,Detalhes,Avaliação,Data,Código,Status\n';
    const row = `${data.chatId},${data.name},${data.matricula},${data.opcao},${data.detalhes},${data.rating},${data.date},${data.code},${data.status}\n`;

    try {
        if (!fs.existsSync(reportFilePath)) {
            fs.writeFileSync(reportFilePath, header);
        }
        fs.appendFileSync(reportFilePath, row);
    } catch (error) {
        console.error('Erro ao salvar o relatório:', error);
    }
}

// Função para enviar e-mail de relatório com fallback
function sendReportEmail() {
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: process.env.EMAIL_USER,
        subject: 'Relatório de Atendimento',
        text: 'Segue em anexo o relatório de atendimentos.',
        attachments: [{ filename: 'atendimentos.csv', path: reportFilePath }],
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.error('Erro ao enviar e-mail:', error);
        } else {
            console.log('E-mail enviado:', info.response);
        }
    });
}

// Função para gerar código de atendimento
function generateTicketCode() {
    return `DP${uuidv4().split('-')[0].toUpperCase()}`;
}

// Função para iniciar o timer do usuário
function startUserTimer(user) {
    const timeoutDuration = user.invalidResponses >= 2 ? 5 * 60 * 1000 : 10 * 60 * 1000; // 5 minutos após respostas inválidas, 10 minutos caso contrário
    user.timer = setTimeout(async () => {
        await client.sendMessage(
            user.chatId,
            '⏳ Olá! Estou aqui se precisar de algo. 😉'
        );
    }, timeoutDuration);
}

// Função para limpar o timer do usuário
function clearUserTimer(user) {
    if (user.timer) {
        clearTimeout(user.timer);
        user.timer = null;
    }
}

// Função de menu de ajuda
async function showHelp(chatId, language = 'pt') {
    const helpText = {
        pt: '📋 Menu de ajuda:\n1️⃣ - Iniciar atendimento\n2️⃣ - Verificar status de protocolo\n3️⃣ - Cancelar atendimento\n4️⃣ - Falar com um atendente humano\n5️⃣ - Ver opções disponíveis',
        en: '📋 Help Menu:\n1️⃣ - Start service\n2️⃣ - Check protocol status\n3️⃣ - Cancel service\n4️⃣ - Talk to a human agent\n5️⃣ - See available options',
    };
    await client.sendMessage(chatId, helpText[language]);
}

// Função para integração com API externa
async function checkOrderStatus(chatId, orderId) {
    try {
        const response = await axios.get(`https://api.exemplo.com/pedido/${orderId}`);
        await client.sendMessage(chatId, `📦 Status do pedido ${orderId}: ${response.data.status}`);
    } catch (error) {
        console.error('Erro ao acessar API externa:', error);
        await client.sendMessage(chatId, '⚠ Ocorreu um erro ao consultar o status do pedido. Tente novamente mais tarde.');
    }
}

// Função para lidar com a resposta do usuário
async function handleUserResponse(user, chatId, text) {
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
        case 'cancel':
            await handleCancelResponse(user, chatId);
            break;
        case 'help':
            await showHelp(chatId, user.language || 'pt');
            break;
        case 'order':
            await checkOrderStatus(chatId, text);
            break;
        default:
            await handleInvalidResponse(user, chatId);
    }
    saveUserState(); // Salva o estado atualizado após cada resposta
}

// Função para lidar com respostas inválidas
async function handleInvalidResponse(user, chatId) {
    user.invalidResponses++;

    if (user.invalidResponses >= 3) {
        await client.sendMessage(chatId, '⚠ Não consegui entender suas mensagens. Você gostaria de falar com um humano? Responda "sim" ou "não".');
        user.awaitingResponse = 'talkToHuman';
    } else {
        await showHelp(chatId, user.language || 'pt');
    }
}

// Painel de administração básico
const app = express();
app.use(express.json());

app.get('/admin/users', (req, res) => {
    res.json(userState);
});

app.get('/admin/reports', (req, res) => {
    if (fs.existsSync(reportFilePath)) {
        res.sendFile(path.resolve(reportFilePath));
    } else {
        res.status(404).send('Relatório não encontrado');
    }
});

app.listen(3000, () => {
    console.log('Painel de administração disponível em http://localhost:3000');
});

// Evento quando QR Code é recebido
client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('QR RECEIVED', qr);
});

// Evento quando o cliente está pronto
client.on('ready', () => {
    console.log('Cliente está pronto! 🎉');
});

// Evento para receber mensagens
client.on('message', async (message) => {
    const chatId = message.from;
    const text = message.body.toLowerCase().trim();

    if (message.isGroupMsg) return; // Ignorar mensagens em grupos

    if (!userState[chatId]) {
        userState[chatId] = { awaitingResponse: 'initial', timer: null, invalidResponses: 0, language: 'pt' }; // Adiciona idioma padrão como 'pt'
        saveUserState(); // Salva o estado do usuário no arquivo
        const greeting = getGreeting();
        await client.sendMessage(
            chatId,
            `${greeting}! Sou a IADP 🤖, sua assistente virtual. Como posso ajudar você hoje?\n\n1️⃣ - Iniciar atendimento\n2️⃣ - Verificar status de protocolo\n3️⃣ - Cancelar atendimento\nDigite "ajuda" para ver todas as opções disponíveis.`
        );
        return;
    }

    const user = userState[chatId];
    clearUserTimer(user);

    try {
        await handleUserResponse(user, chatId, text);
    } catch (error) {
        console.error('Erro ao processar a resposta do usuário:', error);
        await client.sendMessage(
            chatId,
            '⚠ Ocorreu um erro ao processar sua solicitação. Por favor, tente novamente mais tarde.'
        );
    }
});

// Iniciar o cliente do WhatsApp
client.initialize();
