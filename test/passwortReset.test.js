jest.mock('../src/models', () => ({
  User: { findOne: jest.fn() }
}));
jest.mock('../src/services/mailerService', () => ({
  sendPasswordResetEmail: jest.fn().mockResolvedValue({ success: true }),
  sendPasswordChangedEmail: jest.fn().mockResolvedValue({ success: true })
}));

const { User } = require('../src/models');
const mailerService = require('../src/services/mailerService');
const userController = require('../src/controllers/userController');

function antwort() {
  const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
  return res;
}

describe('Passwort-Reset', () => {
  let user;

  beforeEach(() => {
    jest.clearAllMocks();
    user = { email: 'konto@example.org', name: 'Konto', update: jest.fn().mockResolvedValue() };
    User.findOne.mockResolvedValue(user);
  });

  test('schickt die Mail an die gespeicherte Adresse des Kontos', async () => {
    await userController.forgotPassword({ body: { email: 'KONTO@example.org' } }, antwort());

    expect(mailerService.sendPasswordResetEmail).toHaveBeenCalledWith(
      'konto@example.org',
      'Konto',
      expect.any(String)
    );
  });

  test.each([
    ['Liste', ['konto@example.org', 'andere@example.org']],
    ['Objekt', { address: 'konto@example.org' }],
    ['Zahl', 1]
  ])('forgotPassword lehnt %s als Adresse ab', async (_, email) => {
    const res = antwort();

    await userController.forgotPassword({ body: { email } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(User.findOne).not.toHaveBeenCalled();
    expect(user.update).not.toHaveBeenCalled();
    expect(mailerService.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  test.each([
    ['Liste', ['a', 'b']],
    ['Objekt', { a: 1 }]
  ])('Token-Endpunkte lehnen %s als Token ab', async (_, token) => {
    const pruefen = antwort();
    const setzen = antwort();

    await userController.validateResetToken({ body: { token } }, pruefen);
    await userController.resetPassword({ body: { resetToken: token, newPassword: 'neu' } }, setzen);

    expect(pruefen.status).toHaveBeenCalledWith(400);
    expect(setzen.status).toHaveBeenCalledWith(400);
    expect(User.findOne).not.toHaveBeenCalled();
  });

  test('ein gültiger Token funktioniert weiter', async () => {
    const res = antwort();

    await userController.validateResetToken({ body: { token: 'abc' } }, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});
