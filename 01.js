import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;

import qrcode from 'qrcode-terminal';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import fs from 'fs';
import XLSX from 'xlsx';

// Carregar variáveis de ambiente
dotenv.config();

// Caminhos dos arquivos
const userStateFilePath = './userState.json';
const reportFilePath = './atendimentos.csv';
const spreadsheetPath = 'C:\\Users\\058718.CBMSA\\Desktop\\EFETIVO UNIFICADO - IMPRIMIR REV01.xlsx';

// Carregar estado do usuário
const loadUserState = () => {
    try {
        if (fs.existsSync(userStateFilePath)) {
            const data = fs.readFileSync(userStateFilePath);
            return JSON.parse(data);
        }
    } catch (err) {
        console.error('Erro ao carregar estado do usuário:', err);
    }
    return {};
};

// Salvar estado do usuário
const saveUserState = (userState) => {
    try {
        fs.writeFileSync(userStateFilePath, JSON.stringify(userState, null, 2));
    } catch (err) {
        console.error('Erro ao salvar estado do usuário:', err);
    }
};

// Inicializar estado do usuário
let userState = loadUserState();

// Configurações do cliente WhatsApp
const client = new Client({
    puppeteer: {
        executablePath: 'C:\\Users\\058718.CBMSA\\Downloads\\chrome-win\\chrome-win\\chrome.exe',
    },
    authStrategy: new LocalAuth(),
});

// Obter saudação com base na hora do dia
const getGreeting = () => {
    const hour = new Date().getHours();
    return hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
};

// Salvar relatório
const saveReport = (data) => {
    const header = 'Chat ID,Nome,Matrícula,Opção,Detalhes,Avaliação,Data,Código,Status\n';
    const row = `${data.chatId},${data.name},${data.matricula},${data.opcao},${data.detalhes},${data.rating},${data.date},${data.code},${data.status}\n`;

    try {
        if (!fs.existsSync(reportFilePath)) {
            fs.writeFileSync(reportFilePath, header);
        }
        fs.appendFileSync(reportFilePath, row);
    } catch (err) {
        console.error('Erro ao salvar relatório:', err);
    }
};

// Gerar código de atendimento
const generateTicketCode = () => `DP${uuidv4().split('-')[0].toUpperCase()}`;

// Validar matrícula
const isValidMatricula = (matricula) => /^0\d{5}$/.test(matricula);

// Obter informações do colaborador da planilha
const getCollaboratorInfo = (matricula) => {
    try {
        const workbook = XLSX.readFile(spreadsheetPath);
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(worksheet);
        return data.find((row) => row['MATRÍCULA'] === matricula) || null;
    } catch (err) {
        console.error('Erro ao buscar informações na planilha:', err);
        return null;
    }
};

// Enviar resumo do atendimento
const sendSummary = async (user, chatId) => {
    const summary = `📋 Resumo do Atendimento:
    Nome: ${user.name}
    Matrícula: ${user.matricula}
    Opção escolhida: ${user.opcao || 'N/A'}
    Detalhes: ${user.detalhes || 'N/A'}
    Avaliação: ${user.rating || 'N/A'}
    Código de atendimento: ${user.code || 'N/A'}

    💬 Se precisar de mais alguma coisa, basta me chamar!`;
    await client.sendMessage(chatId, summary);
};

// Lidar com a resposta da consulta
const handleConsultaInfoResponse = async (user, chatId, text) => {
    const collaboratorInfo = getCollaboratorInfo(user.matricula);
    if (!collaboratorInfo) {
        await client.sendMessage(chatId, '⚠ Informações não encontradas. Tente novamente.');
        return;
    }

    const infoKeys = Object.keys(collaboratorInfo);
    const selectedInfo = infoKeys[text - 1];

    if (selectedInfo) {
        await client.sendMessage(chatId, `📄 Informação: ${collaboratorInfo[selectedInfo]}`);

        // Pergunta se o usuário deseja mais informações ou finalizar o atendimento
        await client.sendMessage(chatId, '📋 Deseja consultar mais informações ou finalizar o atendimento?\n1️⃣ - Consultar mais informações\n2️⃣ - Finalizar atendimento');
        user.awaitingResponse = 'maisInformacoesOuVoltar';
    } else {
        await client.sendMessage(chatId, '⚠ Opção inválida. Tente novamente.');
    }
};

// Manipulador para a resposta de mais informações ou finalizar
const handleMaisInformacoesOuVoltarResponse = async (user, chatId, text) => {
    if (text === '1') {
        await handleOpcaoResponse(user, chatId, user.opcao);
    } else if (text === '2') {
        await sendSummary(user, chatId); // Enviar resumo antes de finalizar
        await client.sendMessage(chatId, '⚠ Atendimento finalizado. Se precisar, é só chamar!');
        user.awaitingResponse = null; // Finaliza o atendimento
    } else {
        await client.sendMessage(chatId, '⚠ Opção inválida. Tente novamente.');
    }
};

// Manipulador principal de resposta do usuário
const handleUserResponse = async (user, chatId, text) => {
    switch (user.awaitingResponse) {
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
        case 'consultaInfo':
            await handleConsultaInfoResponse(user, chatId, text);
            break;
        case 'maisInformacoesOuVoltar':
            await handleMaisInformacoesOuVoltarResponse(user, chatId, text);
            break;
        case 'duvidasBeneficios':
            await handleDuviasBeneficiosResponse(user, chatId, text);
            break;
        case 'opcaoFinalizar':
            await handleOpcaoFinalizarResponse(user, chatId, text);
            break;
        default:
            await handleFirstMessage(user, chatId);
    }
};

// Manipulador inicial de apresentação
const handleFirstMessage = async (user, chatId) => {
    const greeting = getGreeting();
    await client.sendMessage(chatId, `${greeting}! 👋 Eu sou o bot de atendimento do DP. Para começar, por favor, forneça sua matrícula.`);
    user.awaitingResponse = 'matricula';
};

// Lidar com a resposta da matrícula
const handleMatriculaResponse = async (user, chatId, text) => {
    if (!isValidMatricula(text)) {
        await client.sendMessage(chatId, '⚠ Matrícula inválida. A matrícula deve ter 6 dígitos e começar com 0. Tente novamente.');
        return;
    }

    const collaboratorInfo = getCollaboratorInfo(text);
    if (collaboratorInfo) {
        user.matricula = text;
        user.name = collaboratorInfo['NOME']; // Armazenar o nome do colaborador
        user.awaitingResponse = 'opcao';
        const optionsText = `📄 Olá ${user.name}, como posso ajudá-lo?\n1️⃣ - Consultar informações\n2️⃣ - Dúvidas sobre benefícios\n3️⃣ - Fazer uma sugestão ou elogio\n4️⃣ - Cancelar atendimento\nDigite o número da opção que você deseja consultar.`;
        await client.sendMessage(chatId, optionsText);
    } else {
        await client.sendMessage(chatId, '⚠ Colaborador não encontrado. Verifique a matrícula e tente novamente.');
    }
};

// Lidar com a resposta da opção
const handleOpcaoResponse = async (user, chatId, text) => {
    const collaboratorInfo = getCollaboratorInfo(user.matricula);
    if (!collaboratorInfo) {
        await client.sendMessage(chatId, '⚠ Colaborador não encontrado. Tente novamente.');
        return;
    }

    user.opcao = text; // Armazenar a opção escolhida

    switch (text) {
        case '1':
            const infoKeys = Object.keys(collaboratorInfo);
            const optionsList = infoKeys.map((key, index) => `${index + 1} - ${key}`).join('\n');
            await client.sendMessage(chatId, `📄 Aqui estão as informações disponíveis:\n${optionsList}\nEscolha um número para consultar.`);
            user.awaitingResponse = 'consultaInfo';
            break;
        case '2':
            await client.sendMessage(chatId, '💼 Selecione a dúvida sobre benefícios:\n1️⃣ - Plano de saúde\n2️⃣ - Ticket restaurante\n3️⃣ - Ticket refeição\n4️⃣ - Férias');
            user.awaitingResponse = 'duvidasBeneficios';
            break;
        case '3':
            await client.sendMessage(chatId, '😊 Agradecemos seu feedback! Por favor, escreva sua sugestão ou elogio.');
            user.awaitingResponse = 'detalhes';
            break;
        case '4':
            await client.sendMessage(chatId, '🛑 Lamentamos que você queira cancelar. Estamos sempre buscando melhorar! Por favor, nos diga o motivo do cancelamento.');
            user.awaitingResponse = 'detalhes';
            break;
        default:
            await client.sendMessage(chatId, '⚠ Opção inválida. Escolha um número válido.');
            break;
    }
};

// Lidar com a resposta de dúvidas sobre benefícios
const handleDuviasBeneficiosResponse = async (user, chatId, text) => {
    const benefitOptions = {
        '1': 'Plano de saúde',
        '2': 'Ticket restaurante',
        '3': 'Ticket refeição',
        '4': 'Férias',
    };

    const benefit = benefitOptions[text];
    if (benefit) {
        await client.sendMessage(chatId, `💼 Você selecionou: ${benefit}. Por favor, detalhe sua dúvida ou problema.`);
        user.awaitingResponse = 'detalhes';
    } else {
        await client.sendMessage(chatId, '⚠ Opção inválida. Tente novamente.');
    }
};

// Lidar com a resposta de detalhes
const handleDetalhesResponse = async (user, chatId, text) => {
    user.detalhes = text;

    if (user.awaitingResponse === 'detalhes') {
        if (text.includes('cancelar')) {
            await client.sendMessage(chatId, '🛑 Lamentamos que você queira cancelar. Estamos sempre buscando melhorar!');
            user.awaitingResponse = 'rating';
        } else {
            await client.sendMessage(chatId, '🔄 Estamos trabalhando para resolver seu problema. Você gostaria de avaliar nosso atendimento? (1 - Sim, 2 - Não)');
            user.awaitingResponse = 'rating';
        }
    } else {
        await client.sendMessage(chatId, '⚠ Detalhes inválidos. Por favor, forneça mais informações.');
    }
};

// Lidar com a resposta de avaliação
const handleRatingResponse = async (user, chatId, text) => {
    if (text === '1') {
        await client.sendMessage(chatId, '💬 Como você avaliaria nosso atendimento? (1 a 5)');
        user.awaitingResponse = 'ratingValue';
    } else {
        await sendSummary(user, chatId); // Enviar resumo mesmo que não avaliado
        await client.sendMessage(chatId, '👍 Agradecemos pelo feedback e pelo seu tempo! Se precisar, é só chamar!');
        user.awaitingResponse = null; // Finaliza o atendimento
    }
};

// Lidar com a resposta de valor da avaliação
const handleRatingValueResponse = async (user, chatId, text) => {
    const ratingValue = parseInt(text, 10);
    if (ratingValue >= 1 && ratingValue <= 5) {
        user.rating = ratingValue;
        user.code = generateTicketCode();
        saveReport({ chatId, ...user, date: new Date().toLocaleString(), status: 'Finalizado' });
        await sendSummary(user, chatId); // Enviar resumo após avaliação
        await client.sendMessage(chatId, '👍 Agradecemos pela sua avaliação! Se precisar, é só chamar!');
        user.awaitingResponse = null; // Finaliza o atendimento
    } else {
        await client.sendMessage(chatId, '⚠ Avaliação inválida. Por favor, forneça um valor entre 1 e 5.');
    }
};

// Lidar com a opção final de finalizar
const handleOpcaoFinalizarResponse = async (user, chatId, text) => {
    if (text === '1') {
        await client.sendMessage(chatId, '⚠ Atendimento finalizado. Se precisar, é só chamar!');
        user.awaitingResponse = null; // Finaliza o atendimento
    } else {
        await client.sendMessage(chatId, '❓ Opção inválida. Digite 1 para finalizar.');
    }
};

// Evento de autenticação do cliente
client.on('authenticated', () => {
    console.log('Cliente autenticado');
});

// Evento de geração do QR Code
client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('QR Code recebido. Escaneie com o WhatsApp.');
});

// Evento de recebimento de mensagens
client.on('message', async (message) => {
    if (message.isGroupMsg) return;

    const chatId = message.from;
    const text = message.body.trim();
    const userId = message.from;

    if (!userState[userId]) {
        userState[userId] = {};
    }

    const user = userState[userId];

    if (user.awaitingResponse === null) {
        await handleFirstMessage(user, chatId);
    } else {
        await handleUserResponse(user, chatId, text);
    }

    saveUserState(userState);
});

// Iniciar o cliente
client.initialize();