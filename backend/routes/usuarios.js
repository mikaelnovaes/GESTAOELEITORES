/**
 * backend/routes/usuarios.js
 * Gestão de usuários — PostgreSQL (somente admin)
 */

'use strict';

const express = require('express');
const bcrypt  = require('bcrypt');
const { body, param, validationResult } = require('express-validator');
const db      = require('../config/database');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAdmin); // Todas as rotas aqui exigem admin

function hasErrors(req, res) {
  const e = validationResult(req);
  if (!e.isEmpty()) { res.status(400).json({ errors: e.array() }); return true; }
  return false;
}

/* ── GET /api/usuarios ───────────────────────────────────── */
router.get('/', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT id, nome, login, tipo, ativo, ultimo_login, criado_em
       FROM usuarios ORDER BY nome ASC`
    );
    res.json(r.rows);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar usuários.' });
  }
});

/* ── POST /api/usuarios ──────────────────────────────────── */
router.post('/',
  [
    body('nome').trim().notEmpty().isLength({ max: 200 }),
    body('login').trim().notEmpty().isLength({ min: 3, max: 100 }).matches(/^[a-z0-9._-]+$/i),
    body('senha').notEmpty().isLength({ min: 6, max: 200 }),
    body('tipo').isIn(['admin', 'comum']),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    const { nome, login, senha, tipo } = req.body;
    try {
      const hash = await bcrypt.hash(senha, 12);
      const r = await db.query(
        `INSERT INTO usuarios (nome, login, senha_hash, tipo)
         VALUES ($1, $2, $3, $4) RETURNING id, criado_em`,
        [nome.trim(), login.toLowerCase(), hash, tipo]
      );
      res.status(201).json(r.rows[0]);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Login já está em uso.' });
      }
      res.status(500).json({ error: 'Erro ao criar usuário.' });
    }
  }
);

/* ── PUT /api/usuarios/:id ───────────────────────────────── */
router.put('/:id',
  [
    param('id').isInt({ min: 1 }).toInt(),
    body('nome').trim().notEmpty().isLength({ max: 200 }),
    body('login').trim().notEmpty().isLength({ min: 3, max: 100 }),
    body('senha').optional({ nullable: true }).isLength({ min: 6, max: 200 }),
    body('tipo').isIn(['admin', 'comum']),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    const { nome, login, senha, tipo } = req.body;
    const id = req.params.id;

    try {
      let hashClause = '';
      const params = [nome.trim(), login.toLowerCase(), tipo, id];

      if (senha) {
        const hash = await bcrypt.hash(senha, 12);
        hashClause = ', senha_hash = $5';
        params.splice(3, 0, hash); // inserir antes do id
        params[params.length - 1] = id; // garantir id no final
      }

      // Rebuild simples para evitar index drift
      let query, qParams;
      if (senha) {
        const hash = await bcrypt.hash(senha, 12);
        query = `UPDATE usuarios SET nome=$1, login=$2, senha_hash=$3, tipo=$4, atualizado_em=NOW() WHERE id=$5 RETURNING id`;
        qParams = [nome.trim(), login.toLowerCase(), hash, tipo, id];
      } else {
        query = `UPDATE usuarios SET nome=$1, login=$2, tipo=$3, atualizado_em=NOW() WHERE id=$4 RETURNING id`;
        qParams = [nome.trim(), login.toLowerCase(), tipo, id];
      }

      const r = await db.query(query, qParams);
      if (!r.rowCount) return res.status(404).json({ error: 'Usuário não encontrado.' });
      res.json({ success: true });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'Login já está em uso.' });
      res.status(500).json({ error: 'Erro ao atualizar usuário.' });
    }
  }
);

/* ── DELETE /api/usuarios/:id ────────────────────────────── */
router.delete('/:id',
  [param('id').isInt({ min: 1 }).toInt()],
  async (req, res) => {
    if (hasErrors(req, res)) return;

    // Proteção: não deletar o próprio usuário
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'Você não pode excluir seu próprio usuário.' });
    }

    try {
      // Soft delete — preserva logs de auditoria
      const r = await db.query(
        `UPDATE usuarios SET ativo = FALSE, atualizado_em = NOW() WHERE id = $1 RETURNING id`,
        [req.params.id]
      );
      if (!r.rowCount) return res.status(404).json({ error: 'Usuário não encontrado.' });
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: 'Erro ao excluir usuário.' });
    }
  }
);

module.exports = router;
