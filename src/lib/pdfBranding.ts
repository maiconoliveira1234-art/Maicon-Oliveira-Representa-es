export const ADIMAX_LOGO_URL = '/adimax-logo.png';

// html2canvas can capture an offscreen report before its images finish loading.
export const waitForReportImages = async (container: Element): Promise<void> => {
  await Promise.all(Array.from(container.querySelectorAll('img')).map(async image => {
    if (!image.complete) {
      await new Promise<void>((resolve, reject) => {
        image.addEventListener('load', () => resolve(), { once: true });
        image.addEventListener('error', () => reject(new Error('Não foi possível carregar a logomarca do relatório.')), { once: true });
      });
    }
    if (!image.naturalWidth) throw new Error('Não foi possível carregar a logomarca do relatório.');
    if (image.decode) await image.decode();
  }));
};
