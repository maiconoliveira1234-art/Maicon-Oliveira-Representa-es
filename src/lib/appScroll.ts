// A página não rola mais no documento (html/body): quem rola é o contêiner
// #app-scroll do Layout. Isso contorna o bug do iOS/iPadOS 26 em que, depois do
// teclado fechar, os elementos position: fixed passam a "andar" com a rolagem.
export const APP_SCROLL_ID = 'app-scroll';

export function getAppScroller(): HTMLElement {
  return document.getElementById(APP_SCROLL_ID)
    ?? (document.scrollingElement as HTMLElement | null)
    ?? document.documentElement;
}

export function scrollAppTo(options: ScrollToOptions) {
  getAppScroller().scrollTo(options);
}
