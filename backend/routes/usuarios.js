/**
 * backend/routes/usuarios.js
 * Gestão de usuários — multi-tenant
 *
 * REGRAS:
 *  - Apenas admin acessa estas rotas.
 *  - Admin só vê/edita usuários do PRÓPRIO tenant.
 *  - Novo usuário herda o tenant_id do admin que o criou.
 *  - Admin NÃO pode rebaixar a si mesmo nem se excluir.
 */

'use strict';

const express = require('express');
const bcrypt  = require('bcrypt');
const { body, param, validationResult } = require('express-validator');
const db      = require('../config/database');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAdmin);

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
       FROM usuarios WHERE tenant_id = $1 ORDER BY nome ASC`,
      [req.user.tenant_id]
    );
    res.json(r.rows.map(u => ({ ...u, id: Number(u.id) })));
  } catch {
    res.status(500).json({ error: 'Erro ao buscar usuários.' });
  }
});

/* ── POST /api/usuarios ──────────────────────────────────── */
router.post('/',
  [
    body('nome').trim().notEmpty().isLength({ max: 200 }),
    body('login').trim().notEmpty().isLength({ min: 3, max: 100 }).matches(/^[a-z0-9._-]+$/i),
    body('senha').notEmpty().isLength({ min: 8, max: 200 })
      .withMessage('Senha deve ter ao menos 8 caracteres.'),
    body('tipo').isIn(['admin', 'comum']),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    const { nome, login, senha, tipo } = req.body;
    try {
      const hash = await bcrypt.hash(senha, 12);
      const r = await db.query(
        `INSERT INTO usuarios (tenant_id, nome, login, senha_hash, tipo)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, criado_em`,
        [req.user.tenant_id, nome.trim(), login.toLowerCase(), hash, tipo]
      );
      res.status(201).json({ id: Number(r.rows[0].id), criado_em: r.rows[0].criado_em });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Login já está em uso.' });
      }
      console.error('[USUARIOS] POST /:', err);
      res.status(500).json({ error: 'Erro ao criar usuário.' });
    }
  }
);

/* ── PUT /api/usuarios/:id ───────────────────────────────── */
router.put('/:id',
  [
    param('id').isInt({ min: 1 }).toInt(),
    body('nome').trim().notEmpty().isLength({ max: 200 }),
    body('login').trim().notEmpty().isLength({ min: 3, max: 100 }).matches(/^[a-z0-9._-]+$/i),
    body('senha').optional({ nullable: true, checkFalsy: true }).isLength({ min: 8, max: 200 }),
    body('tipo').isIn(['admin', 'comum']),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    const { nome, login, senha, tipo } = req.body;
    const id = req.params.id;

    // Proteção: admin não pode rebaixar a si mesmo
    if (Number(id) === Number(req.user.id) && tipo !== 'admin') {
      return res.status(400).json({ error: 'Você não pode remover seu próprio perfil de administrador.' });
    }

    try {
      let query, qParams;
      if (senha) {
        const hash = await bcrypt.hash(senha, 12);
        query = `UPDATE usuarios
                 SET nome=$1, login=$2, senha_hash=$3, tipo=$4, atualizado_em=NOW()
                 WHERE id=$5 AND tenant_id=$6
                 RETURNING id`;
        qParams = [nome.trim(), login.toLowerCase(), hash, tipo, id, req.user.tenant_id];
      } else {
        query = `UPDATE usuarios
                 SET nome=$1, login=$2, tipo=$3, atualizado_em=NOW()
                 WHERE id=$4 AND tenant_id=$5
                 RETURNING id`;
        qParams = [nome.trim(), login.toLowerCase(), tipo, id, req.user.tenant_id];
      }

      const r = await db.query(query, qParams);
      if (!r.rowCount) return res.status(404).json({ error: 'Usuário não encontrado.' });
      res.json({ success: true });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'Login já está em uso.' });
      console.error('[USUARIOS] PUT /:id:', err);
      res.status(500).json({ error: 'Erro ao atualizar usuário.' });
    }
  }
);

/* ── DELETE /api/usuarios/:id ────────────────────────────── */
router.delete('/:id',
  [param('id').isInt({ min: 1 }).toInt()],
  async (req, res) => {
    if (hasErrors(req, res)) return;

    // CORREÇÃO: comparação número x número (antes era string x number)
    if (Number(req.params.id) === Number(req.user.id)) {
      return res.status(400).json({ error: 'Você não pode excluir seu próprio usuário.' });
    }

    try {
      // Soft delete dentro do tenant
      const r = await db.query(
        `UPDATE usuarios SET ativo = FALSE, atualizado_em = NOW()
         WHERE id = $1 AND tenant_id = $2 RETURNING id`,
        [req.params.id, req.user.tenant_id]
      );
      if (!r.rowCount) return res.status(404).json({ error: 'Usuário não encontrado.' });
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: 'Erro ao excluir usuário.' });
    }
  }
);

module.exports = router;
