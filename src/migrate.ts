/**
 * SCRIPT DE MIGRATION — AgriPrix
 * Migrations de schéma MongoDB versionnées
 *
 * Usage:
 *   ts-node src/migrate.ts                 # Applique toutes les migrations en attente
 *   ts-node src/migrate.ts --status        # Affiche l'état des migrations
 *   ts-node src/migrate.ts --rollback v002 # Annule une migration spécifique
 */

import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/agriprix';

// ---- Schéma de tracking des migrations ----

const MigrationSchema = new mongoose.Schema({
  version: { type: String, required: true, unique: true },
  name: String,
  appliedAt: { type: Date, default: Date.now },
  status: { type: String, enum: ['applied', 'rolled_back'], default: 'applied' },
});

// ---- Définition des migrations ----

interface Migration {
  version: string;
  name: string;
  up: (db: mongoose.Connection) => Promise<void>;
  down: (db: mongoose.Connection) => Promise<void>;
}

const migrations: Migration[] = [
  // -------------------------------------------------------
  // v001 — Ajout du champ 'language' aux utilisateurs existants
  // -------------------------------------------------------
  {
    version: 'v001',
    name: 'add-language-to-users',
    async up(db) {
      await db.collection('users').updateMany(
        { language: { $exists: false } },
        { $set: { language: 'fr' } }
      );
      console.log('  → language:fr ajouté à tous les utilisateurs existants');
    },
    async down(db) {
      await db.collection('users').updateMany(
        {},
        { $unset: { language: '' } }
      );
    },
  },

  // -------------------------------------------------------
  // v002 — Ajout du champ 'isActive' aux prix
  // -------------------------------------------------------
  {
    version: 'v002',
    name: 'add-isactive-to-prices',
    async up(db) {
      const result = await db.collection('prices').updateMany(
        { isActive: { $exists: false } },
        { $set: { isActive: true } }
      );
      console.log(`  → isActive:true ajouté à ${result.modifiedCount} prix`);
    },
    async down(db) {
      await db.collection('prices').updateMany({}, { $unset: { isActive: '' } });
    },
  },

  // -------------------------------------------------------
  // v003 — Création des index de performance
  // -------------------------------------------------------
  {
    version: 'v003',
    name: 'create-performance-indexes',
    async up(db) {
      // Index composé pour les requêtes de tendances (le plus utilisé)
      await db.collection('prices').createIndex(
        { cropId: 1, region: 1, date: -1 },
        { name: 'idx_prices_crop_region_date', background: true }
      );

      // Index pour les prédictions récentes
      await db.collection('predictions').createIndex(
        { cropId: 1, region: 1, generatedAt: -1 },
        { name: 'idx_predictions_crop_region_date', background: true }
      );

      // Index TTL pour nettoyer les anciennes alertes (90 jours)
      await db.collection('alerts').createIndex(
        { createdAt: 1 },
        { expireAfterSeconds: 90 * 24 * 3600, name: 'idx_alerts_ttl' }
      );

      // Index pour les recommandations expirées
      await db.collection('recommendations').createIndex(
        { validUntil: 1 },
        { name: 'idx_recommendations_valid_until', background: true }
      );

      console.log('  → 4 index créés avec succès');
    },
    async down(db) {
      const collections = ['prices', 'predictions', 'alerts', 'recommendations'];
      for (const col of collections) {
        try {
          await db.collection(col).dropIndexes();
        } catch (_) {}
      }
    },
  },

  // -------------------------------------------------------
  // v004 — Normalisation des slugs de cultures (lowercase)
  // -------------------------------------------------------
  {
    version: 'v004',
    name: 'normalize-crop-slugs',
    async up(db) {
      const crops = await db.collection('crops').find({}).toArray();
      let updated = 0;

      for (const crop of crops) {
        const normalizedSlug = crop.slug
          ?.toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '') // Supprime les accents
          .replace(/\s+/g, '-')
          .replace(/[^a-z0-9-]/g, '');

        if (normalizedSlug && normalizedSlug !== crop.slug) {
          await db.collection('crops').updateOne(
            { _id: crop._id },
            { $set: { slug: normalizedSlug } }
          );
          updated++;
        }
      }
      console.log(`  → ${updated} slugs normalisés`);
    },
    async down(db) {
      // Pas de rollback possible sans les valeurs originales
      console.log('  → Rollback v004: opération irréversible, ignorée');
    },
  },
];

// ---- Runner ----

async function runMigrations() {
  console.log('🌾 AgriPrix — Migrations MongoDB');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection;
  const MigrationModel = mongoose.model('Migration', MigrationSchema);

  const args = process.argv.slice(2);

  // Afficher le statut
  if (args.includes('--status')) {
    const applied = await MigrationModel.find({ status: 'applied' }).lean();
    const appliedVersions = applied.map((m) => m.version);

    console.log('\nMigrations:');
    for (const m of migrations) {
      const isApplied = appliedVersions.includes(m.version);
      console.log(`  ${isApplied ? '✅' : '⏳'} ${m.version} — ${m.name}`);
    }
    await mongoose.disconnect();
    return;
  }

  // Rollback
  if (args.includes('--rollback')) {
    const version = args[args.indexOf('--rollback') + 1];
    const migration = migrations.find((m) => m.version === version);
    if (!migration) {
      console.error(`❌ Migration "${version}" introuvable`);
      process.exit(1);
    }
    console.log(`\n↩️  Rollback: ${version} — ${migration.name}`);
    await migration.down(db);
    await MigrationModel.updateOne(
      { version },
      { $set: { status: 'rolled_back' } }
    );
    console.log('✅ Rollback terminé');
    await mongoose.disconnect();
    return;
  }

  // Appliquer les migrations en attente
  const applied = await MigrationModel.find({ status: 'applied' }).lean();
  const appliedVersions = applied.map((m) => m.version);
  const pending = migrations.filter((m) => !appliedVersions.includes(m.version));

  if (pending.length === 0) {
    console.log('\n✅ Toutes les migrations sont à jour');
    await mongoose.disconnect();
    return;
  }

  console.log(`\n⏳ ${pending.length} migration(s) en attente:\n`);

  for (const migration of pending) {
    console.log(`▶ ${migration.version} — ${migration.name}`);
    try {
      await migration.up(db);
      await MigrationModel.create({ version: migration.version, name: migration.name });
      console.log(`  ✅ Succès\n`);
    } catch (error) {
      console.error(`  ❌ Erreur: ${error.message}`);
      console.error('  Migration arrêtée. Corrigez et relancez.');
      await mongoose.disconnect();
      process.exit(1);
    }
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ Toutes les migrations appliquées');
  await mongoose.disconnect();
}

runMigrations().catch((err) => {
  console.error('❌ Erreur fatale:', err);
  process.exit(1);
});
