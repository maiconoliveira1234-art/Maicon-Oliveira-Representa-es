// Reconhecimento de produtos pedidos pelo WhatsApp.
//
// Este arquivo é a fonte única. As edge functions recebem uma cópia idêntica
// (supabase/functions/<nome>/productMatch.ts) via `node scripts/sync-llm.mjs`.
// Por isso ele não importa nada: precisa rodar igual no navegador, no Node (testes) e no Deno.
//
// Como funciona:
// 1. O texto do cliente e o nome de cada produto passam pelo mesmo dicionário de abreviações
//    e viram uma "ficha" de atributos (marca, peso da unidade, família, espécie, porte, fase,
//    sabor, cuidado e raça) mais as palavras que sobraram.
// 2. Marca e peso filtram o catálogo (estão em 100% dos produtos). Espécie também, para nunca
//    trocar ração de gato por ração de cão.
// 3. Os demais atributos dão pontos quando batem e tiram quando contradizem. O que o cliente não
//    informou não conta contra, exceto "cuidado específico" e "raça": se ele não pediu, o produto
//    comum fica à frente do especial.
// 4. Se sobram candidatos muito próximos, o item é marcado como ambíguo e o painel mostra o que
//    falta o cliente dizer (ex.: sabor Carne ou Salmão), em vez de escolher no chute.

export type Atributo = 'marca' | 'familia' | 'especie' | 'porte' | 'fase' | 'sabor' | 'cuidado' | 'raca';
export type TipoTermo = Atributo | 'sinonimo';
export const ATRIBUTOS: Atributo[] = ['marca', 'familia', 'especie', 'porte', 'fase', 'sabor', 'cuidado', 'raca'];

export const NOME_ATRIBUTO: Record<TipoTermo, string> = {
  marca: 'Marca', familia: 'Família', especie: 'Espécie', porte: 'Porte', fase: 'Fase da vida',
  sabor: 'Sabor', cuidado: 'Cuidado específico', raca: 'Raça', sinonimo: 'Sinônimo',
};

/** Um termo do dicionário: `termo` (uma ou mais palavras) significa `valor` no atributo.
 *  Valores múltiplos são separados por "|" (ex.: MP = MINI|PEQ).
 *  Para `sinonimo`, `valor` é o texto que substitui o termo (ex.: FEMU -> FEMUR). */
export type Termo = { termo: string; atributo: TipoTermo; valor: string };

// Valores canônicos e como aparecem na tela.
export const ROTULOS: Record<Atributo, Record<string, string>> = {
  marca: { FN: 'Formula Natural', ORIGENS: 'Origens', MAGNUS: 'Magnus', GATAN: 'Gatan', CAPITAO: 'Capitão' },
  familia: {
    LIFE: 'Life', FM: 'Fresh Meat', PRO: 'Pro', VET: 'Vet Care', NAT: 'Natural', CLASS: 'Class', ENERGY: 'Energy',
    TD: 'Todo Dia', CHIPS: 'Chips', GOURMET: 'Gourmet', RECCASE: 'Receitas Caseiras', ORGANIC: 'Organic',
    SNACKS: 'Snacks', BISC: 'Biscoito', BIFINHO: 'Bifinho', PN: 'Petisco Natural', PETISCO: 'Petisco',
    DENTAL: 'Dental', SACHE: 'Sachê', CREMINHO: 'Creminho', COOKIES: 'Cookies', PATE: 'Patê', UMIDO: 'Úmido',
    AMOSTRA: 'Amostra', RACAS: 'Raças Específicas',
  },
  especie: { CAO: 'Cão', GATO: 'Gato' },
  porte: { MINI: 'Mini', PEQ: 'Pequeno', MED: 'Médio', GR: 'Grande', GIG: 'Gigante' },
  fase: { FILH: 'Filhote', AD: 'Adulto', SEN: 'Sênior' },
  sabor: {
    CARNE: 'Carne', FRANGO: 'Frango', SALMAO: 'Salmão', CORDEIRO: 'Cordeiro', OVELHA: 'Ovelha', PERU: 'Peru',
    ATUM: 'Atum', BATATA: 'Batata', ABOBORA: 'Abóbora', BANANA: 'Banana', MANGA: 'Manga', MARACUJA: 'Maracujá',
    LINHACA: 'Linhaça', FRUTAS: 'Frutas',
  },
  cuidado: {
    CAST: 'Castrado', SKIN: 'Skin', CONT: 'Controle de peso', LIGHT: 'Light', SENSITIVE: 'Sensitive',
    HIPO: 'Hipoalergênico', OBES: 'Obesidade', RENAL: 'Renal', GASTRO: 'Gastrointestinal', URINARIA: 'Urinária',
    OSTEO: 'Osteoartrite', RECUPERACAO: 'Recuperação', HAIRBALL: 'Hairball', PELOLONGO: 'Pelo longo',
    ORAL: 'Cuidado oral', ANTIESTRESSE: 'Antiestresse', PELE: 'Pele e pelagem', VITALIDADE: 'Vitalidade',
  },
  raca: {
    SHIHTZU: 'Shih Tzu', LHASA: 'Lhasa', YORK: 'Yorkshire', MALTES: 'Maltês', SPITZ: 'Spitz', BULDOG: 'Buldogue',
    PUG: 'Pug', LABRADOR: 'Labrador', GOLDEN: 'Golden', PITBULL: 'Pit Bull', ROTTWEILER: 'Rottweiler',
  },
};

// Dicionário base: [termos separados por vírgula, atributo, valor]. Termos de várias palavras valem como frase.
const BASE: Array<[string, Atributo, string]> = [
  ['FN,FORMULA NATURAL,FORMULA,FORMULANATURAL,FORM NAT,FORM NATURAL,FORM', 'marca', 'FN'],
  ['ORIGENS,ORIG,ORIGEM,ORIGES', 'marca', 'ORIGENS'],
  ['MAGNUS,MAG,MAGNO', 'marca', 'MAGNUS'],
  ['GATAN', 'marca', 'GATAN'],
  ['CAPITAO', 'marca', 'CAPITAO'],

  ['LIFE,LAIF,LAIFE', 'familia', 'LIFE'],
  ['FM,FRESH MEAT,FRESH,FRESHMEAT', 'familia', 'FM'],
  ['PRO', 'familia', 'PRO'],
  ['VET,VET CARE,VETCARE', 'familia', 'VET'],
  ['NAT,NATURAL', 'familia', 'NAT'],
  ['CLASS,CLASSIC', 'familia', 'CLASS'],
  ['ENERGY', 'familia', 'ENERGY'],
  ['TD,T D,TODO DIA,TODODIA', 'familia', 'TD'],
  ['CHIPS', 'familia', 'CHIPS'],
  ['GOURMET', 'familia', 'GOURMET'],
  ['REC CASE,RECEITAS CASEIRAS,RECEITA CASEIRA,RECCASE', 'familia', 'RECCASE'],
  ['ORG,ORGANIC,ORGANICO,ORGANICOS', 'familia', 'ORGANIC'],
  ['SNACKS,SNACK', 'familia', 'SNACKS'],
  ['BISC,BISCOITO,BISCOITOS,BISCUITS,BISCUIT', 'familia', 'BISC'],
  ['BIFINHO,BIFINHOS', 'familia', 'BIFINHO'],
  ['PN,PETISCO NATURAL,PETISCOS NATURAIS', 'familia', 'PN'],
  // "Petisco Origens Fêmur" é a linha PN: petisco genérico aceita as duas.
  ['PETISCO,PETISCOS', 'familia', 'PETISCO|PN'],
  ['DENTAL', 'familia', 'DENTAL'],
  ['SACHE,SACHES,SACHET', 'familia', 'SACHE'],
  ['CREMINHO,CREMINHOS', 'familia', 'CREMINHO'],
  ['COOKIES,COOKIE', 'familia', 'COOKIES'],
  ['PATE', 'familia', 'PATE'],
  ['UMID,UMIDO,UMIDA', 'familia', 'UMIDO'],
  ['AMOSTRA,AMOSTRAS', 'familia', 'AMOSTRA'],
  ['RACAS ESPECIFICAS,RACA ESPECIFICA', 'familia', 'RACAS'],

  ['CAO,CAES,CACHORRO,CACHORROS,DOG,DOGS,CANINO,CANINOS', 'especie', 'CAO'],
  ['GATO,GATOS,GATA,GATAS,CAT,CATS,FELINO,FELINOS', 'especie', 'GATO'],

  ['MINI,MIN,MINIS', 'porte', 'MINI'],
  ['PEQ,PQ,PEQUENO,PEQUENOS,PEQUENA,PEQUENAS', 'porte', 'PEQ'],
  ['MED,MD,MEDIO,MEDIOS,MEDIA,MEDIAS', 'porte', 'MED'],
  ['GR,GD,GDE,GRAND,GRANDE,GRANDES', 'porte', 'GR'],
  ['GIG,GIGANTE,GIGANTES', 'porte', 'GIG'],
  ['MP,MINI E PEQUENO,MINI E PEQUENOS,MINI E PEQ,MINI PEQ', 'porte', 'MINI|PEQ'],
  ['PP,PEQ PORTE,PEQ PORT,PEQUENO PORTE,PEQUENOS PORTES,RACAS PEQUENAS,RACA PEQUENA', 'porte', 'MINI|PEQ'],
  ['MG,MEDIO E GRANDE,MEDIOS E GRANDES,MED E GR,MEDIO GRANDE', 'porte', 'MED|GR'],

  ['FILH,FILHOTE,FILHOTES,FILHT,FILHOT,FILHOTINHO', 'fase', 'FILH'],
  ['AD,ADULTO,ADULTOS,ADULTA,ADULT', 'fase', 'AD'],
  ['SEN,SENIO,SENIOR,SENIORS,IDOSO,IDOSOS', 'fase', 'SEN'],

  ['CARNE,CN,CAR,CARN', 'sabor', 'CARNE'],
  ['FRANGO,FG,FR,FRAN,FRANG,FRA', 'sabor', 'FRANGO'],
  ['SALMAO,SALM,SAL,SA', 'sabor', 'SALMAO'],
  ['CORDEIRO,CORD,COR,CORDEIR', 'sabor', 'CORDEIRO'],
  ['OVELHA,OVEL', 'sabor', 'OVELHA'],
  ['PERU', 'sabor', 'PERU'],
  ['ATUM,ATU', 'sabor', 'ATUM'],
  ['BATATA', 'sabor', 'BATATA'],
  ['ABOBORA,ABOBOR', 'sabor', 'ABOBORA'],
  ['BANANA', 'sabor', 'BANANA'],
  ['MANGA', 'sabor', 'MANGA'],
  ['MARACUJA,MARACU', 'sabor', 'MARACUJA'],
  ['LINHACA,LINHAC', 'sabor', 'LINHACA'],
  ['FRUTAS,FRUTA', 'sabor', 'FRUTAS'],

  ['CAST,CASTRADO,CASTRADOS,CASTRADA,CASTRADAS', 'cuidado', 'CAST'],
  ['SKIN', 'cuidado', 'SKIN'],
  ['CONT,CONTROLE,CONT PESO,CONTROLE DE PESO,CONTROLE PESO', 'cuidado', 'CONT'],
  ['LIGHT,LIGH,LITE', 'cuidado', 'LIGHT'],
  ['SENS,SENSI,SENSITIVE,SENSIVEL', 'cuidado', 'SENSITIVE'],
  ['HIPO,HIPOALERGENICO,HIPOALERGENICA,HIPOALERGENICOS', 'cuidado', 'HIPO'],
  ['OBES,OBESIDADE,OBESO', 'cuidado', 'OBES'],
  ['RENAL', 'cuidado', 'RENAL'],
  ['GASTRO,GASTROINTESTINAL,GASTRICO', 'cuidado', 'GASTRO'],
  ['URINARIA,URINARIO,URINARY', 'cuidado', 'URINARIA'],
  ['OSTEOARTRITE,OSTEO,ARTRITE', 'cuidado', 'OSTEO'],
  ['RECUPERAC,RECUPERACAO', 'cuidado', 'RECUPERACAO'],
  ['HAIRBALL,BOLA DE PELO,BOLA PELO,BOLAS DE PELO,BOLA', 'cuidado', 'HAIRBALL'],
  ['PELO LONGO,PELOS LONGOS', 'cuidado', 'PELOLONGO'],
  ['ORAL,CUID ORAL,CUIDADO ORAL', 'cuidado', 'ORAL'],
  ['ANTIESTRES,ANTIESTRESSE,ANTI ESTRESSE', 'cuidado', 'ANTIESTRESSE'],
  ['PELE PELAG,PELE E PELAGEM,PELAGEM,PELE', 'cuidado', 'PELE'],
  ['VITALIDADE', 'cuidado', 'VITALIDADE'],

  ['SHIHTZU,SHIH TZU,SHITZU,SHITSU,SHIHTSU,SHIT TZU', 'raca', 'SHIHTZU'],
  ['LHASA,LHASSA,LASA', 'raca', 'LHASA'],
  ['YORK,YORKSHIRE,YORKIE', 'raca', 'YORK'],
  ['MALT,MALTES,MALTEZ', 'raca', 'MALTES'],
  ['SPI,SPITZ,LULU', 'raca', 'SPITZ'],
  ['BULDOG,BULLDOG,BULDOGUE', 'raca', 'BULDOG'],
  ['PUG', 'raca', 'PUG'],
  ['LABRADOR', 'raca', 'LABRADOR'],
  ['GOLDEN', 'raca', 'GOLDEN'],
  ['PITBULL,PIT BULL,PIT', 'raca', 'PITBULL'],
  ['ROTTW,ROTTWEILER,ROTWEILER', 'raca', 'ROTTWEILER'],
];

export const DICIONARIO_BASE: Termo[] = BASE.flatMap(([termos, atributo, valor]) =>
  termos.split(',').map(termo => ({ termo, atributo, valor })));

// Palavras que não ajudam a distinguir produtos.
const IGNORAR = new Set([
  'E', 'DE', 'DO', 'DA', 'DOS', 'DAS', 'C', 'COM', 'P', 'PARA', 'PRA', 'SABOR', 'RACAO', 'RACOES', 'PORT', 'PORTE',
  'UN', 'UND', 'UNID', 'UNIDADE', 'UNIDADES', 'CX', 'CXS', 'CAIXA', 'CAIXAS', 'SACO', 'SACOS', 'FARDO', 'FARDOS',
  'PCT', 'PACOTE', 'PACOTES', 'KG', 'G', 'X', 'O', 'A', 'OS', 'AS', 'UM', 'UMA', 'MAIS', 'TB', 'TAMBEM', 'QUERO',
  'MANDA', 'MANDAR', 'ME', 'NO', 'NA', 'EM', 'LINHA', 'TIPO', 'PET', 'ESP',
]);

/** Texto em maiúsculas, sem acentos. */
export function semAcento(texto: string): string {
  return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

const num = (s: string) => Number(String(s).replace(',', '.'));
const emKg = (valor: number, unidade: string | undefined) => (/^G/.test(unidade || '') ? valor / 1000 : valor);
const UN_KG = 'KGS?|KILOS?|QUILOS?|K';
const UN_G = 'GRAMAS?|GRS?|G';
const UNIDADE = `(${UN_KG}|${UN_G})`;
const NUMERO = '(\\d+(?:[.,]\\d+)?)';

type Peso = { unidadeKg: number | null; unidades: number | null; solto: number | null };

/** Retira do texto o peso da embalagem: "4X3KG", "2X(10X40G)", "10,1KG", "18X85". */
function extrairPeso(texto: string, aceitarNumeroSolto: boolean): { resto: string; peso: Peso } {
  let resto = texto;
  const peso: Peso = { unidadeKg: null, unidades: null, solto: null };
  const aninhado = new RegExp(`(?<![\\d.,])(\\d+)\\s*X\\s*\\(\\s*(\\d+)\\s*X\\s*${NUMERO}\\s*${UNIDADE}?\\s*\\)`);
  const multiplo = new RegExp(`(?<![\\d.,])(\\d+)\\s*X\\s*${NUMERO}\\s*${UNIDADE}?(?![A-Z])`);
  const simples = new RegExp(`(?<![\\d.,])${NUMERO}\\s*${UNIDADE}(?![A-Z])`);
  let m = resto.match(aninhado);
  if (m) {
    peso.unidades = Number(m[1]) * Number(m[2]);
    peso.unidadeKg = emKg(num(m[3]), m[4] || (num(m[3]) >= 30 ? 'G' : 'KG'));
    resto = resto.replace(m[0], ' ');
  } else if ((m = resto.match(multiplo))) {
    peso.unidades = Number(m[1]);
    // Sem unidade escrita ("ATU18X85"): números grandes são gramas.
    peso.unidadeKg = emKg(num(m[2]), m[3] || (num(m[2]) >= 30 ? 'G' : 'KG'));
    resto = resto.replace(m[0], ' ');
  } else if ((m = resto.match(simples))) {
    peso.unidadeKg = emKg(num(m[1]), m[2]);
    resto = resto.replace(m[0], ' ');
  }
  if (peso.unidadeKg === null && aceitarNumeroSolto) {
    // "magnus gato castrado 10": número solto que parece peso (não "7+", não quantidade com unidade).
    const solto = [...resto.matchAll(/(?<![\d.,+])(\d{1,2}(?:[.,]\d)?)(?![\d+])/g)].map(x => num(x[1])).filter(n => n >= 1 && n <= 25);
    if (solto.length) peso.solto = solto[solto.length - 1];
  }
  return { resto, peso };
}

export type Ficha = {
  atributos: Record<Atributo, Set<string>>;
  pesoUnidadeKg: number | null;
  unidadesPorCaixa: number | null;
  pesoCaixaKg: number | null;
  /** Número sem unidade escrito pelo cliente (talvez o peso). */
  numeroSolto: number | null;
  /** Palavras que nenhum termo do dicionário reconheceu. */
  palavras: string[];
  /** Espécie deduzida (produto sem "cão"/"gato" escrito). */
  especieDeduzida: boolean;
  /** Fase deduzida (ração sem fase escrita é de adulto). */
  faseDeduzida: boolean;
};

export type Dicionario = {
  frases: Map<string, Termo[]>;
  maiorFrase: number;
};

/** Junta o dicionário base com os termos aprendidos/aprovados. */
export function montarDicionario(extras: Termo[] = []): Dicionario {
  const frases = new Map<string, Termo[]>();
  let maiorFrase = 1;
  for (const t of [...DICIONARIO_BASE, ...extras]) {
    const chave = semAcento(t.termo).replace(/[^A-Z0-9]+/g, ' ').trim();
    if (!chave) continue;
    const valor = t.atributo === 'sinonimo' ? semAcento(t.valor).replace(/[^A-Z0-9]+/g, ' ').trim() : semAcento(t.valor).replace(/[^A-Z0-9|]+/g, '');
    if (!valor) continue;
    const lista = frases.get(chave) || [];
    if (!lista.some(x => x.atributo === t.atributo && x.valor === valor)) lista.push({ termo: chave, atributo: t.atributo, valor });
    frases.set(chave, lista);
    maiorFrase = Math.max(maiorFrase, chave.split(' ').length);
  }
  return { frases, maiorFrase };
}

const DICIONARIO_PADRAO = montarDicionario();

function vazia(): Record<Atributo, Set<string>> {
  return Object.fromEntries(ATRIBUTOS.map(a => [a, new Set<string>()])) as Record<Atributo, Set<string>>;
}

/** Transforma um texto (pedido do cliente ou nome do produto) em ficha de atributos. */
export function fichaDoTexto(texto: string, opcoes: { dicionario?: Dicionario; cliente?: boolean } = {}): Ficha {
  const dic = opcoes.dicionario || DICIONARIO_PADRAO;
  const { resto, peso } = extrairPeso(semAcento(texto), Boolean(opcoes.cliente));
  const limpo = resto
    .replace(/\bM\s*\/\s*P\b/g, ' MP ').replace(/\bM\s*\/\s*G\b/g, ' MG ')
    .replace(/\bMIN\s*\/\s*P\b/g, ' MINI PEQ ').replace(/\bMINI\s*\/\s*P\b/g, ' MINI PEQ ')
    .replace(/[^A-Z0-9]+/g, ' ').trim();
  let tokens = limpo ? limpo.split(' ') : [];
  const atributos = vazia();
  const palavras: string[] = [];
  // Sinônimos aprendidos primeiro, depois atributos; sempre a frase mais longa possível.
  for (let passo = 0; passo < 2; passo++) {
    const saida: string[] = [];
    for (let i = 0; i < tokens.length;) {
      let usado = 0;
      for (let n = Math.min(dic.maiorFrase, tokens.length - i); n >= 1 && !usado; n--) {
        const termos = dic.frases.get(tokens.slice(i, i + n).join(' '));
        if (!termos) continue;
        if (passo === 0) {
          const sin = termos.find(t => t.atributo === 'sinonimo');
          if (sin) { saida.push(...sin.valor.split(' ')); usado = n; }
        } else {
          const attrs = termos.filter(t => t.atributo !== 'sinonimo');
          if (attrs.length) {
            for (const t of attrs) for (const v of t.valor.split('|')) if (v) atributos[t.atributo as Atributo].add(v);
            usado = n;
          }
        }
      }
      if (usado) i += usado;
      else {
        if (passo === 0) saida.push(tokens[i]);
        else if (tokens[i].length >= 2 && !IGNORAR.has(tokens[i]) && !/^\d+$/.test(tokens[i])) palavras.push(tokens[i]);
        i++;
      }
    }
    if (passo === 0) tokens = saida;
  }
  let especieDeduzida = false;
  if (!opcoes.cliente) {
    if (atributos.raca.size) atributos.familia.add('RACAS');
    // Ração de gato sempre traz GATO/CAT no nome; sem espécie escrita, o produto é para cães.
    if (!atributos.especie.size) {
      especieDeduzida = true;
      atributos.especie.add(atributos.marca.has('GATAN') || atributos.familia.has('CREMINHO') ? 'GATO' : 'CAO');
    }
  }
  return {
    atributos, palavras, especieDeduzida, faseDeduzida: false,
    pesoUnidadeKg: peso.unidadeKg,
    unidadesPorCaixa: peso.unidades,
    pesoCaixaKg: peso.unidadeKg !== null ? +(peso.unidadeKg * (peso.unidades || 1)).toFixed(3) : null,
    numeroSolto: peso.solto,
  };
}

export type ProdutoCatalogo = { id: string; produto: string; peso_embalagem?: number | null; quant_embalagem?: number | null };

/** Ficha do produto, completando o peso pelo cadastro quando o nome não traz. */
export function fichaDoProduto(p: ProdutoCatalogo, dicionario?: Dicionario): Ficha {
  const f = fichaDoTexto(p.produto, { dicionario });
  const total = Number(p.peso_embalagem), qt = Number(p.quant_embalagem);
  if (f.pesoUnidadeKg === null && total > 0 && qt > 0) {
    f.pesoUnidadeKg = +(total / qt).toFixed(3);
    f.unidadesPorCaixa = qt;
    f.pesoCaixaKg = total;
  }
  // Ração (embalagem de 1kg ou mais) sem filhote/sênior no nome é de adulto.
  if (!f.atributos.fase.size && f.pesoUnidadeKg !== null && f.pesoUnidadeKg >= 1) {
    f.atributos.fase.add('AD');
    f.faseDeduzida = true;
  }
  return f;
}

const mesmoPeso = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.001, b * 0.02); // 10kg ~ 10,1kg

export type Comparacao = {
  pontos: number;
  /** Atributos que o cliente informou e o produto contradiz. */
  conflitos: Atributo[];
  peso: 'unidade' | 'caixa' | 'diferente' | 'nao_informado';
  eliminado: boolean;
};

// igual: bate exatamente; parcial: bate em parte (ex.: Pequeno x Mini/Pequeno); contra: contradiz;
// naoPedido: o produto é "especial" nesse atributo e o cliente não pediu; semNoProduto: o cliente
// pediu e o produto não traz o atributo.
const PESOS: Record<Atributo, { igual: number; parcial: number; contra: number; naoPedido: number; semNoProduto: number }> = {
  marca: { igual: 20, parcial: 20, contra: -40, naoPedido: 0, semNoProduto: 0 },
  familia: { igual: 12, parcial: 8, contra: -15, naoPedido: 0, semNoProduto: 0 },
  especie: { igual: 6, parcial: 6, contra: -40, naoPedido: -5, semNoProduto: 0 },
  porte: { igual: 10, parcial: 6, contra: -12, naoPedido: -2, semNoProduto: -4 },
  fase: { igual: 10, parcial: 6, contra: -12, naoPedido: -3, semNoProduto: 0 },
  sabor: { igual: 10, parcial: 7, contra: -12, naoPedido: 0, semNoProduto: 0 },
  cuidado: { igual: 12, parcial: 8, contra: -12, naoPedido: -6, semNoProduto: 0 },
  raca: { igual: 15, parcial: 12, contra: -15, naoPedido: -4, semNoProduto: 0 },
};

/** O produto é "especial" num atributo que o cliente não mencionou? */
function especialNaoPedido(a: Atributo, produto: Ficha): boolean {
  const p = produto.atributos[a];
  if (!p.size) return false;
  // Quem compra ração de gato quase sempre escreve gato/cat; sem espécie, cão vem primeiro.
  if (a === 'especie') return !produto.especieDeduzida && !p.has('CAO');
  // Sem fase escrita, o cliente quer o adulto.
  if (a === 'fase') return !produto.faseDeduzida && !p.has('AD');
  return true;
}

export function comparar(cliente: Ficha, produto: Ficha): Comparacao {
  let pontos = 0;
  const conflitos: Atributo[] = [];
  let eliminado = false;
  for (const a of ATRIBUTOS) {
    const c = cliente.atributos[a], p = produto.atributos[a];
    const w = PESOS[a];
    if (!c.size) { if (especialNaoPedido(a, produto)) pontos += w.naoPedido; continue; }
    if (!p.size) { pontos += w.semNoProduto; continue; }
    const comuns = [...c].filter(v => p.has(v)).length;
    if (!comuns) {
      pontos += w.contra;
      conflitos.push(a);
      if (a === 'marca' || a === 'especie') eliminado = true;
    } else pontos += comuns === c.size && comuns === p.size ? w.igual : w.parcial;
  }
  // Amostras só entram quando pedidas.
  if (produto.atributos.familia.has('AMOSTRA') && !cliente.atributos.familia.has('AMOSTRA')) pontos -= 25;
  // Sem peso nenhum (brindes, banners, camisetas): só aparece se o nome bater.
  if (produto.pesoUnidadeKg === null) pontos -= 15;
  let peso: Comparacao['peso'] = 'nao_informado';
  const pedido = cliente.pesoUnidadeKg ?? cliente.numeroSolto;
  if (pedido !== null && produto.pesoUnidadeKg !== null) {
    const forte = cliente.pesoUnidadeKg !== null;
    if (mesmoPeso(pedido, produto.pesoUnidadeKg)
      && (cliente.unidadesPorCaixa === null || cliente.unidadesPorCaixa === produto.unidadesPorCaixa || produto.unidadesPorCaixa === null)) {
      peso = 'unidade'; pontos += forte ? 15 : 8;
    } else if (mesmoPeso(pedido, produto.pesoUnidadeKg)) {
      peso = 'unidade'; pontos += forte ? 10 : 6;
    } else if (produto.pesoCaixaKg !== null && mesmoPeso(pedido, produto.pesoCaixaKg)) {
      // O cliente quase sempre pede pelo peso da unidade; peso da caixa fica como segunda opção.
      peso = 'caixa'; pontos += forte ? 5 : 2;
    } else {
      peso = 'diferente'; pontos -= forte ? 20 : 4;
    }
  }
  const restantes = new Set(produto.palavras);
  for (const w of cliente.palavras) if (restantes.has(w)) pontos += 4;
  return { pontos, conflitos, peso, eliminado };
}

export type Historico = Map<string, { orders: number; last: string }>;

export type Candidato = {
  id: string;
  produto: string;
  score: number;
  /** Pontos só pelos atributos, sem o histórico do cliente. */
  pontos_atributos: number;
  conflitos: string[];
  peso: Comparacao['peso'];
  historico_compras: { ocorrencias: number; ultima_compra: string } | null;
};

export type Ambiguidade = {
  /** Atributos em que os candidatos empatados diferem e o cliente não disse qual quer. */
  atributos: Array<{ atributo: Atributo | 'peso'; nome: string; opcoes: string[] }>;
  mensagem: string;
};

export type ResultadoBusca = {
  candidatos: Candidato[];
  ambiguidade: Ambiguidade | null;
  /** Filtros obrigatórios que precisaram ser relaxados por não haver produto que atendesse. */
  filtro_relaxado: Array<'peso' | 'marca'> ;
  /** Primeiro candidato está claramente à frente e sem contradições. */
  vencedor_claro: boolean;
  atributos_cliente: Record<string, string[]>;
};

export type ProdutoComFicha = ProdutoCatalogo & { ficha: Ficha };

export function prepararCatalogo(produtos: ProdutoCatalogo[], dicionario?: Dicionario): ProdutoComFicha[] {
  return produtos.map(p => ({ ...p, ficha: fichaDoProduto(p, dicionario) }));
}

const MARGEM_EMPATE = 6;

function rotulo(a: Atributo, v: string) { return ROTULOS[a][v] || v; }
function descreverValores(a: Atributo, valores: Set<string>) { return [...valores].map(v => rotulo(a, v)).join('/') || '—'; }
function formatarKg(kg: number) {
  return kg < 1 ? `${Math.round(kg * 1000)}g` : `${String(+kg.toFixed(2)).replace('.', ',')}kg`;
}

export function resumoFicha(f: Ficha): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const a of ATRIBUTOS) if (f.atributos[a].size) out[a] = [...f.atributos[a]].map(v => rotulo(a, v));
  if (f.pesoUnidadeKg !== null) out.peso = [formatarKg(f.pesoUnidadeKg) + (f.unidadesPorCaixa && f.unidadesPorCaixa > 1 ? ` (cx ${f.unidadesPorCaixa})` : '')];
  else if (f.numeroSolto !== null) out.peso = [`${String(f.numeroSolto).replace('.', ',')}?`];
  if (f.palavras.length) out.palavras = f.palavras;
  return out;
}

/** Busca em funil: filtros obrigatórios, pontuação por atributo, histórico como desempate. */
export function buscarProdutos(consulta: string, catalogo: ProdutoComFicha[], opcoes: {
  dicionarioCliente?: Dicionario; historico?: Historico; limite?: number;
  /** Quantas vezes cada produto foi vendido (todos os clientes): só desempata. */
  popularidade?: Map<string, number>;
} = {}): ResultadoBusca {
  const cliente = fichaDoTexto(consulta, { dicionario: opcoes.dicionarioCliente, cliente: true });
  const historico = opcoes.historico || new Map();
  const comparados = catalogo.map(p => ({ p, c: comparar(cliente, p.ficha) })).filter(x => !x.c.eliminado);
  const filtro_relaxado: ResultadoBusca['filtro_relaxado'] = [];
  let pool = comparados;
  if (cliente.pesoUnidadeKg !== null) {
    const comPeso = pool.filter(x => x.c.peso === 'unidade' || x.c.peso === 'caixa');
    if (comPeso.length) pool = comPeso; else filtro_relaxado.push('peso');
  }
  const temSinal = ATRIBUTOS.some(a => cliente.atributos[a].size) || cliente.palavras.length > 0;
  const minimo = temSinal ? 1 : Number.POSITIVE_INFINITY;
  const ordenados = pool.filter(x => x.c.pontos >= minimo)
    .sort((a, b) => b.c.pontos - a.c.pontos || a.p.produto.localeCompare(b.p.produto));
  const topo = ordenados[0]?.c.pontos ?? 0;
  const empatados = ordenados.filter(x => x.c.pontos >= topo - MARGEM_EMPATE && x.c.conflitos.length === 0).slice(0, 8);

  let ambiguidade: Ambiguidade | null = null;
  if (empatados.length >= 2) {
    const atributos: Ambiguidade['atributos'] = [];
    for (const a of ATRIBUTOS) {
      if (cliente.atributos[a].size) continue;
      const opcoes = [...new Set(empatados.map(x => descreverValores(a, x.p.ficha.atributos[a])))];
      if (opcoes.length > 1) atributos.push({ atributo: a, nome: NOME_ATRIBUTO[a], opcoes });
    }
    const pesos = [...new Set(empatados.map(x => x.p.ficha.pesoUnidadeKg === null ? '—' : formatarKg(x.p.ficha.pesoUnidadeKg)
      + (x.p.ficha.unidadesPorCaixa && x.p.ficha.unidadesPorCaixa > 1 ? ` (cx ${x.p.ficha.unidadesPorCaixa})` : '')))];
    if (pesos.length > 1) atributos.push({ atributo: 'peso', nome: 'Embalagem', opcoes: pesos });
    const partes = atributos.slice(0, 3).map(x => `${x.nome.toLowerCase()} (${x.opcoes.slice(0, 4).join(' ou ')})`);
    ambiguidade = {
      atributos,
      mensagem: partes.length
        ? `Cliente não informou ${partes.join(', ')}.`
        : `${empatados.length} produtos atendem igualmente ao pedido.`,
    };
  }

  const historicoBonus = (id: string) => {
    const h = historico.get(id);
    if (!h) return 0;
    const dias = Math.max(0, (Date.now() - new Date(h.last + 'T00:00:00Z').getTime()) / 86400000);
    return 6 + Math.min(6, Math.log2(1 + h.orders) * 2) + (dias <= 90 ? 4 : dias <= 180 ? 2 : 0);
  };
  const candidatos: Candidato[] = ordenados.slice(0, 25).map(({ p, c }) => {
    const h = historico.get(p.id);
    return {
      id: p.id, produto: p.produto, pontos_atributos: c.pontos,
      // O histórico só desempata entre produtos compatíveis; nunca vence uma contradição.
      score: Math.round((c.pontos + (c.conflitos.length ? 0 : historicoBonus(p.id))
        + Math.min(2, Math.log10(1 + (opcoes.popularidade?.get(p.id) || 0)) / 2)) * 10) / 10,
      conflitos: c.conflitos.map(a => NOME_ATRIBUTO[a]),
      peso: c.peso,
      historico_compras: h ? { ocorrencias: h.orders, ultima_compra: h.last } : null,
    };
  }).sort((a, b) => b.score - a.score || a.produto.localeCompare(b.produto)).slice(0, opcoes.limite ?? 5);

  const primeiro = ordenados[0];
  const vencedor_claro = Boolean(primeiro && !ambiguidade && primeiro.c.conflitos.length === 0
    && cliente.atributos.marca.size > 0 && primeiro.c.peso === 'unidade');
  return { candidatos, ambiguidade, filtro_relaxado, vencedor_claro, atributos_cliente: resumoFicha(cliente) };
}

// ---------------------------------------------------------------------------------------------
// Aprendizado de termos a partir das correções.

export type TermoSugerido = { termo: string; atributo: TipoTermo; valor: string };

/** Compara o que o cliente escreveu com o produto que o usuário confirmou e propõe termos novos.
 *  Ex.: "magnus felinu castrado 10" confirmado como MAGNUS CAT AD CAST ... -> FELINU = Espécie Gato.
 *  Só propõe quando a ligação é razoavelmente clara (poucas palavras desconhecidas e poucos
 *  atributos faltando). A mesma sugestão precisa se repetir para ser mostrada para aprovação. */
export function inferirTermos(expressao: string, produto: ProdutoCatalogo, dicionario?: Dicionario): TermoSugerido[] {
  const cliente = fichaDoTexto(expressao, { dicionario, cliente: true });
  const prod = fichaDoProduto(produto, dicionario);
  const palavrasProduto = new Set(prod.palavras);
  const desconhecidas = [...new Set(cliente.palavras)]
    .filter(w => /^[A-Z][A-Z0-9]{1,19}$/.test(w) && !palavrasProduto.has(w));
  if (!desconhecidas.length || desconhecidas.length > 2) return [];
  const faltando = ATRIBUTOS.filter(a => prod.atributos[a].size && !cliente.atributos[a].size
    && !(a === 'especie' && prod.especieDeduzida) && !(a === 'familia' && [...prod.atributos[a]].every(v => v === 'RACAS')));
  const sugestoes: TermoSugerido[] = [];
  if (faltando.length >= 1 && faltando.length <= 3) {
    for (const termo of desconhecidas) for (const a of faltando)
      sugestoes.push({ termo, atributo: a, valor: [...prod.atributos[a]].filter(v => v !== 'RACAS').join('|') });
  } else if (!faltando.length && desconhecidas.length === 1) {
    const sobra = prod.palavras.filter(w => !cliente.palavras.includes(w));
    if (sobra.length === 1) sugestoes.push({ termo: desconhecidas[0], atributo: 'sinonimo', valor: sobra[0] });
  }
  return sugestoes.filter(s => s.valor);
}

/** Descrição legível de um termo: "GATO → Espécie: Gato". */
export function descreverTermo(t: { termo: string; atributo: TipoTermo; valor: string }): string {
  if (t.atributo === 'sinonimo') return `${t.termo} = ${t.valor}`;
  return `${t.termo} = ${NOME_ATRIBUTO[t.atributo]}: ${t.valor.split('|').map(v => rotulo(t.atributo as Atributo, v)).join(' e ')}`;
}
