const spieleController = require('../../controllers/spieleController');
const { ballersClubService } = require('./service');

async function getSpiele(req, res) {
  return spieleController.getAllSpiele({ query: { ...req.query, source: 'ballers-club' } }, res);
}

async function getStatus(req, res) {
  res.json({ success: true, data: await ballersClubService.publicState() });
}

module.exports = { getSpiele, getStatus };
