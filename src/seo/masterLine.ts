/**
 * «Ви майстер? Рахуйте матеріали прямо в кошторисі для клієнта →» — one quiet line between a calculator's
 * form and its answer, for every calculator page (calcPage.ts, wallAreaPage.ts). The block AFTER the answer
 * reached only those who pressed «Порахувати» (4 of 24); this one is there before anyone does.
 */
export function masterTopLine(): HTMLElement {
  const line = document.createElement('p');
  line.className = 'seo-master-line';
  const link = document.createElement('a');
  link.href = '/register';
  link.dataset.track = 'calc:top';
  link.textContent = 'Ви майстер? Рахуйте матеріали прямо в кошторисі для клієнта →';
  line.append(link);
  return line;
}

/** Puts the line right above the answer section — i.e. just under the form. */
export function installMasterTopLine(result: HTMLElement | null): void {
  if (!result || result.previousElementSibling?.classList.contains('seo-master-line')) return;
  result.before(masterTopLine());
}
