/**
 * SCRIPT DE SEED — Données de test pour AgriPrix
 * Lance avec: ts-node seed.ts
 */

import mongoose from 'mongoose';
import * as bcrypt from 'bcryptjs';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/agriprix';

// ---- Données des cultures ----
const CROPS = [
  { name: 'Maïs', slug: 'mais', nameLocal: 'Mbéy', unit: 'kg', harvestMonths: [10, 11, 12] },
  { name: 'Mil', slug: 'mil', nameLocal: 'Sanyo', unit: 'kg', harvestMonths: [10, 11] },
  { name: 'Sorgho', slug: 'sorgho', nameLocal: 'Gawri', unit: 'kg', harvestMonths: [11, 12] },
  { name: 'Arachide', slug: 'arachide', nameLocal: 'Thiaw', unit: 'kg', harvestMonths: [10, 11, 12] },
  { name: 'Niébé', slug: 'niebe', nameLocal: 'Nyobé', unit: 'kg', harvestMonths: [9, 10] },
  { name: 'Riz local', slug: 'riz-local', nameLocal: 'Ceeb bu dëkk', unit: 'kg', harvestMonths: [11, 12, 1] },
  { name: 'Manioc', slug: 'manioc', nameLocal: 'Mbañ', unit: 'kg', harvestMonths: [1, 2, 3, 4, 5, 6] },
  { name: 'Tomate', slug: 'tomate', nameLocal: 'Tomaat', unit: 'kg', harvestMonths: [1, 2, 3, 4] },
];

const REGIONS = ['Dakar', 'Thiès', 'Kaolack', 'Ziguinchor', 'Saint-Louis', 'Tambacounda', 'Diourbel', 'Fatick'];
const MARKETS = {
  Dakar: ['Marché Sandaga', 'Marché HLM', 'Marché Tilène'],
  Thiès: ['Marché Central', 'Marché Mbour', 'Marché Tivaouane'],
  Kaolack: ['Marché Central Kaolack', 'Marché Biscuiterie'],
  Ziguinchor: ['Marché Central Zig', 'Marché Boucotte'],
  'Saint-Louis': ['Marché Sor', 'Marché Île à Morphil'],
  Tambacounda: ['Grand Marché Tamba'],
  Diourbel: ['Marché Central Diourbel'],
  Fatick: ['Marché Fatick'],
};

// Prix de base en FCFA/kg avec variation saisonnière
const BASE_PRICES: Record<string, number> = {
  mais: 200,
  mil: 250,
  sorgho: 220,
  arachide: 450,
  niebe: 400,
  'riz-local': 350,
  manioc: 120,
  tomate: 300,
};

function generateHistoricalPrices(cropSlug: string, region: string, days: number) {
  const basePrice = BASE_PRICES[cropSlug] || 250;
  const prices = [];
  const now = new Date();

  for (let i = days; i >= 0; i--) {
    const date = new Date(now.getTime() - i * 86400000);
    const month = date.getMonth() + 1;

    // Saisonnalité: prix plus bas après récolte (Oct-Déc), plus hauts en soudure (Juin-Août)
    let seasonalFactor = 1.0;
    if ([10, 11, 12].includes(month)) seasonalFactor = 0.8; // Récolte
    if ([6, 7, 8].includes(month)) seasonalFactor = 1.3;    // Soudure
    if ([1, 2, 3].includes(month)) seasonalFactor = 1.1;    // Post-récolte

    // Variation aléatoire ±10%
    const noise = 1 + (Math.random() - 0.5) * 0.2;

    // Légère tendance haussière sur le temps
    const trend = 1 + (days - i) * 0.0005;

    const price = Math.round(basePrice * seasonalFactor * noise * trend);
    const markets = MARKETS[region] || ['Marché Central'];

    prices.push({
      region,
      market: markets[Math.floor(Math.random() * markets.length)],
      pricePerUnit: price,
      currency: 'XOF',
      date,
      source: 'seed',
    });
  }
  return prices;
}

async function seed() {
  console.log('🌾 Connexion à MongoDB...');
  await mongoose.connect(MONGODB_URI);

  const db = mongoose.connection;

  // Nettoyage des collections
  console.log('🧹 Nettoyage des données existantes...');
  await Promise.all([
    db.collection('users').deleteMany({}),
    db.collection('crops').deleteMany({}),
    db.collection('prices').deleteMany({}),
    db.collection('predictions').deleteMany({}),
    db.collection('recommendations').deleteMany({}),
    db.collection('alerts').deleteMany({}),
  ]);

  // ---- 1. Création des cultures ----
  console.log('🌽 Insertion des cultures...');
  const cropDocs = await db.collection('crops').insertMany(
    CROPS.map((c) => ({ ...c, isActive: true, createdAt: new Date(), updatedAt: new Date() }))
  );
  const cropIds = Object.values(cropDocs.insertedIds);
  const cropIdMap: Record<string, any> = {};
  CROPS.forEach((c, i) => { cropIdMap[c.slug] = cropIds[i]; });

  // ---- 2. Création des utilisateurs ----
  console.log('👤 Création des utilisateurs de test...');
  const hashedPwd = await bcrypt.hash('password123', 12);

  await db.collection('users').insertMany([
    {
      name: 'Admin AgriPrix',
      email: 'admin@agriprix.sn',
      password: hashedPwd,
      phone: '+221771000000',
      region: 'Dakar',
      role: 'admin',
      isActive: true,
      language: 'fr',
      followedCrops: cropIds.slice(0, 4),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      name: 'Amadou Diallo',
      email: 'amadou@test.sn',
      password: hashedPwd,
      phone: '+221777123456',
      region: 'Kaolack',
      role: 'farmer',
      isActive: true,
      language: 'fr',
      followedCrops: [cropIdMap['mais'], cropIdMap['arachide'], cropIdMap['mil']],
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      name: 'Fatou Sow',
      email: 'fatou@test.sn',
      password: hashedPwd,
      phone: '+221766987654',
      region: 'Thiès',
      role: 'farmer',
      isActive: true,
      language: 'fr',
      followedCrops: [cropIdMap['tomate'], cropIdMap['niebe'], cropIdMap['manioc']],
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]);

  // ---- 3. Génération des données de prix historiques (90 jours) ----
  console.log('💰 Génération des prix historiques (90 jours × cultures × régions)...');
  let totalPrices = 0;

  for (const crop of CROPS) {
    for (const region of REGIONS) {
      const prices = generateHistoricalPrices(crop.slug, region, 90);
      const pricesWithCrop = prices.map((p) => ({
        ...p,
        cropId: cropIdMap[crop.slug],
        createdAt: p.date,
        updatedAt: p.date,
      }));
      await db.collection('prices').insertMany(pricesWithCrop);
      totalPrices += pricesWithCrop.length;
    }
  }

  console.log(`✅ ${totalPrices} entrées de prix générées`);

  // ---- 4. Création d'index MongoDB ----
  console.log('📊 Création des index...');
  await db.collection('prices').createIndex({ cropId: 1, region: 1, date: -1 });
  await db.collection('prices').createIndex({ date: -1 });
  await db.collection('predictions').createIndex({ cropId: 1, region: 1, generatedAt: -1 });
  await db.collection('users').createIndex({ email: 1 }, { unique: true });

  console.log('\n🎉 Seed terminé avec succès !');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Comptes de test créés:');
  console.log('  Admin: admin@agriprix.sn / password123');
  console.log('  Agriculteur 1: amadou@test.sn / password123');
  console.log('  Agriculteur 2: fatou@test.sn / password123');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('❌ Erreur seed:', err);
  process.exit(1);
});
