/**
 * Reorganiza a planilha do zero:
 * limpa tudo, aplica novo cabecalho e formatacao completa
 */

const { google } = require("googleapis");
const path = require("path");

const SHEET_ID = "1IZTRE-aYZ1kfMe04fClHWc0JUShlQJxgp51I2_JsKlI";
const SHEET_NOME = "Leads";

const CABECALHO = [
  "Nome da Empresa",      // A
  "Telefone",             // B
  "Website",              // C
  "Endereço",             // D
  "Bairro",               // E
  "CEP",                  // F
  "Avaliação Google ⭐",  // G
  "Nº Avaliações",        // H
  "Categoria",            // I
  "Email",                // J
  "Instagram",            // K
  "Status do Lead",       // L
  "Data do Contato",      // M
  "Observações",          // N
];

const LARGURAS = [240, 145, 210, 260, 120, 100, 130, 120, 160, 210, 190, 155, 130, 220];

async function main() {
  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, "credentials.json"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  console.log("\n  Reorganizando planilha...\n");

  // Busca sheetId interno
  const info = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const aba = info.data.sheets.find(s => s.properties.title === SHEET_NOME) || info.data.sheets[0];
  const gid = aba.properties.sheetId;

  // 1. Limpa tudo
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NOME}`,
  });
  console.log("  ✓ Dados antigos removidos");

  // 2. Remove formatacoes e validacoes existentes
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [
        {
          updateCells: {
            range: { sheetId: gid },
            fields: "userEnteredFormat,dataValidation",
          }
        }
      ]
    }
  });
  console.log("  ✓ Formatacoes antigas limpas");

  // 3. Escreve cabecalho
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NOME}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [CABECALHO] },
  });
  console.log("  ✓ Cabecalho escrito");

  // 4. Aplica toda a formatacao
  const requests = [
    // Fundo branco em toda a planilha
    {
      repeatCell: {
        range: { sheetId: gid },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 1, green: 1, blue: 1 },
            textFormat: { fontSize: 10, bold: false },
            verticalAlignment: "MIDDLE",
          }
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,verticalAlignment)"
      }
    },
    // Cabecalho: azul escuro + texto branco + negrito + centralizado
    {
      repeatCell: {
        range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1 },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.13, green: 0.27, blue: 0.53 },
            textFormat: { bold: true, fontSize: 10, foregroundColor: { red: 1, green: 1, blue: 1 } },
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE",
          }
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"
      }
    },
    // Borda em toda a tabela
    {
      updateBorders: {
        range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: CABECALHO.length },
        bottom: { style: "SOLID_MEDIUM", color: { red: 0.13, green: 0.27, blue: 0.53 } },
        innerHorizontal: { style: "SOLID", color: { red: 0.8, green: 0.8, blue: 0.8 } },
        innerVertical: { style: "SOLID", color: { red: 0.8, green: 0.8, blue: 0.8 } },
      }
    },
    // Congela linha 1
    {
      updateSheetProperties: {
        properties: { sheetId: gid, gridProperties: { frozenRowCount: 1 } },
        fields: "gridProperties.frozenRowCount"
      }
    },
    // Altura linha cabecalho
    {
      updateDimensionProperties: {
        range: { sheetId: gid, dimension: "ROWS", startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 38 },
        fields: "pixelSize"
      }
    },
    // Altura padrao das linhas de dados
    {
      updateDimensionProperties: {
        range: { sheetId: gid, dimension: "ROWS", startIndex: 1, endIndex: 50000 },
        properties: { pixelSize: 24 },
        fields: "pixelSize"
      }
    },
    // Ativa filtros
    {
      setBasicFilter: {
        filter: {
          range: {
            sheetId: gid,
            startRowIndex: 0,
            startColumnIndex: 0,
            endColumnIndex: CABECALHO.length
          }
        }
      }
    },
    // Dropdown — Status do Lead (coluna V = index 21)
    {
      setDataValidation: {
        range: {
          sheetId: gid,
          startRowIndex: 1, endRowIndex: 50000,
          startColumnIndex: 11, endColumnIndex: 12
        },
        rule: {
          condition: {
            type: "ONE_OF_LIST",
            values: [
              { userEnteredValue: "Não contatado" },
              { userEnteredValue: "Em contato" },
              { userEnteredValue: "Proposta enviada" },
              { userEnteredValue: "Convertido ✓" },
              { userEnteredValue: "Sem interesse" },
              { userEnteredValue: "Sem resposta" },
            ]
          },
          showCustomUi: true,
          strict: false
        }
      }
    },
    // Formatacao condicional — verde para Convertido
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [{
            sheetId: gid,
            startRowIndex: 1, endRowIndex: 50000,
            startColumnIndex: 0, endColumnIndex: CABECALHO.length
          }],
          booleanRule: {
            condition: { type: "TEXT_CONTAINS", values: [{ userEnteredValue: "Convertido" }] },
            format: { backgroundColor: { red: 0.83, green: 0.95, blue: 0.83 } }
          }
        },
        index: 0
      }
    },
    // Formatacao condicional — cinza para Sem interesse
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [{
            sheetId: gid,
            startRowIndex: 1, endRowIndex: 50000,
            startColumnIndex: 0, endColumnIndex: CABECALHO.length
          }],
          booleanRule: {
            condition: { type: "TEXT_CONTAINS", values: [{ userEnteredValue: "Sem interesse" }] },
            format: { backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 } }
          }
        },
        index: 1
      }
    },
    // Formatacao condicional — amarelo claro para Em contato
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [{
            sheetId: gid,
            startRowIndex: 1, endRowIndex: 50000,
            startColumnIndex: 0, endColumnIndex: CABECALHO.length
          }],
          booleanRule: {
            condition: { type: "TEXT_CONTAINS", values: [{ userEnteredValue: "Em contato" }] },
            format: { backgroundColor: { red: 1, green: 0.97, blue: 0.8 } }
          }
        },
        index: 2
      }
    },
    // Larguras das colunas
    ...LARGURAS.map((px, i) => ({
      updateDimensionProperties: {
        range: { sheetId: gid, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 },
        properties: { pixelSize: px },
        fields: "pixelSize"
      }
    })),
  ];

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { requests }
  });

  console.log("  ✓ Formatacao aplicada");
  console.log("  ✓ Dropdown de status configurado");
  console.log("  ✓ Cores condicionais aplicadas");
  console.log("  ✓ Filtros ativos");
  console.log("  ✓ Larguras ajustadas");
  console.log(`\n  Planilha pronta: https://docs.google.com/spreadsheets/d/${SHEET_ID}\n`);
}

main().catch(err => {
  console.error("  ERRO:", err.message);
  process.exit(1);
});
