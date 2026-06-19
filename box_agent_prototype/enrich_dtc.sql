-- enrich_dtc.sql — Backfill des colonnes fault_category + severity de dtc_codes (18 806 lignes).
-- Logique identique à box_agent_prototype/dtc_enrich.mjs (catégorie déterministe + gravité heuristique).
--
-- ⚠️ MUTATION PROD. Procédure SÛRE et RÉVERSIBLE :
--   1) Lancer le DRY-RUN (SELECT) ci-dessous → vérifier la répartition.
--   2) Créer le backup (CREATE TABLE ...).
--   3) Lancer l'UPDATE dans une transaction.
--   4) Rollback possible depuis le backup.
-- NB : le Box n'a PAS besoin de ce backfill (il calcule à la volée via dtc_enrich.mjs).
--      Ce script sert si on veut trier/filtrer par gravité côté SQL/UI.

-- ── Expression CATÉGORIE (déterministe depuis le code) ─────────────────────────
-- (réutilisée dans le SELECT et l'UPDATE)
--   left(code,1) = système ; substring(code,3,1) = sous-système

-- ── 1) DRY-RUN : répartition prévue (lecture seule, n'écrit RIEN) ──────────────
SELECT
  CASE left(code,1)
    WHEN 'B' THEN 'Carrosserie'
    WHEN 'C' THEN 'Châssis'
    WHEN 'U' THEN 'Réseau / Communication'
    WHEN 'P' THEN CASE substring(code,3,1)
      WHEN '0' THEN 'Carburant / Air (dosage & émissions)'
      WHEN '1' THEN 'Carburant / Air (dosage)'
      WHEN '2' THEN 'Carburant / Air (injection)'
      WHEN '3' THEN 'Allumage / Ratés de combustion'
      WHEN '4' THEN 'Émissions auxiliaires (EGR, catalyseur, EVAP)'
      WHEN '5' THEN 'Régime / Ralenti / Entrées auxiliaires'
      WHEN '6' THEN 'Calculateur / Circuits de sortie'
      WHEN '7' THEN 'Transmission' WHEN '8' THEN 'Transmission' WHEN '9' THEN 'Transmission / SAE'
      WHEN 'A' THEN 'Propulsion hybride' WHEN 'B' THEN 'Propulsion hybride' WHEN 'C' THEN 'Propulsion hybride'
      ELSE 'Moteur / Transmission' END
    ELSE NULL END AS cat_prevue,
  CASE
    WHEN left(code,1)='C' AND description ~* 'brake|abs|frein|stability|esp' THEN 'élevée'
    WHEN left(code,1)='P' AND substring(code,3,1)='3' THEN 'élevée'
    WHEN description ~* 'misfire|rat[ée]|overheat|surchauff|oil pressure|brake|frein|airbag|steering|direction|knock|cliquetis|head gasket|joint de culasse|timing|distribution' THEN 'élevée'
    WHEN description ~* 'evap|small leak|petite fuite|purge|gas cap|bouchon|readiness|ambient|lamp|voyant|comfort|confort' THEN 'faible'
    ELSE 'modérée' END AS sev_prevue,
  count(*) AS nb
FROM dtc_codes
GROUP BY 1, 2
ORDER BY nb DESC;

-- ── 2) BACKUP (à lancer avant tout UPDATE) ─────────────────────────────────────
-- CREATE TABLE dtc_codes_backup_20260618 AS SELECT id, code, fault_category, severity FROM dtc_codes;

-- ── 3) APPLICATION (dé-commenter pour exécuter, après validation du dry-run) ───
-- BEGIN;
-- UPDATE dtc_codes SET fault_category =
--   CASE left(code,1)
--     WHEN 'B' THEN 'Carrosserie' WHEN 'C' THEN 'Châssis' WHEN 'U' THEN 'Réseau / Communication'
--     WHEN 'P' THEN CASE substring(code,3,1)
--       WHEN '0' THEN 'Carburant / Air (dosage & émissions)' WHEN '1' THEN 'Carburant / Air (dosage)'
--       WHEN '2' THEN 'Carburant / Air (injection)' WHEN '3' THEN 'Allumage / Ratés de combustion'
--       WHEN '4' THEN 'Émissions auxiliaires (EGR, catalyseur, EVAP)' WHEN '5' THEN 'Régime / Ralenti / Entrées auxiliaires'
--       WHEN '6' THEN 'Calculateur / Circuits de sortie' WHEN '7' THEN 'Transmission' WHEN '8' THEN 'Transmission'
--       WHEN '9' THEN 'Transmission / SAE' WHEN 'A' THEN 'Propulsion hybride' WHEN 'B' THEN 'Propulsion hybride'
--       WHEN 'C' THEN 'Propulsion hybride' ELSE 'Moteur / Transmission' END
--     ELSE NULL END;
-- UPDATE dtc_codes SET severity =
--   CASE
--     WHEN left(code,1)='C' AND description ~* 'brake|abs|frein|stability|esp' THEN 'élevée'
--     WHEN left(code,1)='P' AND substring(code,3,1)='3' THEN 'élevée'
--     WHEN description ~* 'misfire|rat[ée]|overheat|surchauff|oil pressure|brake|frein|airbag|steering|direction|knock|cliquetis|head gasket|joint de culasse|timing|distribution' THEN 'élevée'
--     WHEN description ~* 'evap|small leak|petite fuite|purge|gas cap|bouchon|readiness|ambient|lamp|voyant|comfort|confort' THEN 'faible'
--     ELSE 'modérée' END;
-- COMMIT;
-- Rollback : UPDATE dtc_codes d SET fault_category=b.fault_category, severity=b.severity
--            FROM dtc_codes_backup_20260618 b WHERE d.id=b.id;
