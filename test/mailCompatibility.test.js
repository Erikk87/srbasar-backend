const nodemailer = require('nodemailer');

test('the audited mailer version still renders mail with the existing transport API, without sending', async () => {
  const transport = nodemailer.createTransport({ jsonTransport: true });
  const result = await transport.sendMail({ from: 'sender@example.test', to: 'recipient@example.test', subject: 'Transport smoke test', text: 'Local rendering only' });
  expect(JSON.parse(result.message)).toMatchObject({ subject: 'Transport smoke test', text: 'Local rendering only' });
});
