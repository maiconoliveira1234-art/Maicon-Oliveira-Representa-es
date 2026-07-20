export const APP_VERSION = '1.20.64';
export const SALES_CUTOFF_DATE = '2026-04-11';
export const SALES_CUTOFF_CLIENTS = [
  'LUCIA IRIA SCHNEIDER FLORES',
  'EVELYN ADRIANE DE SENNE',
  'ANTONIO DE SOUSA PINHO',
  'SABRINA C PEREIRA DE FARIAS',
  'PEDRO DE FARIAS',
  'VANIA VANESSA DA SILVA M B',
  'AGROMER AGROPECUARIA LTDA',
  'AGROPECUARIA LAPA LTDA',
  'AGROPECUARIA TALISMA LTDA',
  'AGROPECUARIA VEIGA LTDA',
  'AGROPETS LTDA',
  'AGRORICO AGROPECUARIA LTDA',
  'ANTONIO CARLOS BRETAS',
  'CUNHA E CIA LTDA',
  'DANIEL JOSE DALABONA',
  'FAMILIAR AGROPECUARIA LTDA',
  'HUG PET SHOW LTDA',
  'JOICE TATIANE CASAGRANDE',
  'RACAO DE PRIMEIRA LTDA',
  'DOUGLAS FORBICE ME'
];

export function shouldExcludeSale(clientNameRaw: string, faturamentoDateStr: string): boolean {
  if (!clientNameRaw) return false;
  
  // Normalize to uppercase, trim and remove accents
  const normalizeText = (text: string) => 
    text.trim()
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, "");

  const nameNormalized = normalizeText(clientNameRaw);

  // Standard cutoff clients checking
  const standardCutoffNormalized = SALES_CUTOFF_CLIENTS.map(normalizeText);
  if (standardCutoffNormalized.includes(nameNormalized)) {
    return faturamentoDateStr < SALES_CUTOFF_DATE;
  }

  // Racao Facil / Ração Fácil checking
  // Rule applies from 2024 to today (June 11, 2026) -> faturamentoDateStr < '2026-06-11'
  if (nameNormalized === 'RACAO FACIL' || nameNormalized.includes('RACAO FACIL')) {
    return faturamentoDateStr < '2026-06-11';
  }

  return false;
}

export const FAMILY_PRIORITY_ORDER = [
  '49 - BISCOITOS',
  '50 - BIFINHO',
  '23 - FN RECEITAS CASEIRAS',
  '25 - FN ORGANIC UMID.',
  '26 - FN ORGANIC BISCOITO',
  '27 - FN SNACKS',
  '62 - FN COOKIES',
  '59 - SACHES ORIGENS',
  '60- ORIGENS CREMINHO',
  '63 - SNACK ORIGENS',
  '35 - DENTAL CARE',
  '56 - PETISCOS',
  '51 - PETISCOS ORIGENS',
  '47 - ALIMENTOS UMIDOS',
  '33 - RECHEADOS MAGNUS',
  '01 - FN PRO (NOVA)',
  '02 - FN LIFE',
  '03 - FN GATO',
  '04 - FN FRESH',
  '07 - FN VET CARE',
  '08 - ORIGENS ESPECIAL',
  '09 - SUPER PREMIUM',
  '10 - PREMIUM ESPECIAL',
  '11 - PREMIUM 2',
  '12 - PREMIUM 1',
  '14 - STANDARD',
  '15 - ECONOMICO',
  '30 - LATA - PATE',
  '55 - PETBOX/GONDOLAS/BRINDES',
  'AMOSTRA - AGROP E VENDAS ONLINE VIGORA 01.02.2024',
  'BRINDES - AGROP E VENDAS ONLINE'
];
