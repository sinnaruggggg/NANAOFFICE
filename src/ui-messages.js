export class UserError extends Error {}

export function userMessage(error, fallback) {
  if (error instanceof UserError) return error.message;
  console.error(error);
  return fallback;
}

let confirming = false;
export function confirmAction(message, action = '확인') {
  const dialog = document.getElementById('app-confirmation');
  if (confirming) return Promise.resolve(false);
  dialog.querySelector('p').textContent = message;
  dialog.querySelector('[value="accept"]').textContent = action;
  dialog.returnValue = '';
  dialog.showModal();
  confirming = true;
  return new Promise(resolve => {
    dialog.addEventListener('close',() => {
      confirming = false;
      resolve(dialog.returnValue === 'accept');
    },{once:true});
  });
}
