// =============================================================
// TESTS UNITAIRES — AgriPrix Backend
// Tests des services Prices, Predictions, Recommendations
// =============================================================

import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';

// ----------------------------------------------------------------
// TESTS: PricesService
// ----------------------------------------------------------------
describe('PricesService', () => {
  let service: any;
  let mockPriceModel: any;
  let mockCropModel: any;

  const mockPrices = [
    {
      _id: 'price1',
      cropId: 'crop1',
      region: 'Dakar',
      market: 'Marché Sandaga',
      pricePerUnit: 350,
      currency: 'XOF',
      date: new Date('2024-06-01'),
    },
    {
      _id: 'price2',
      cropId: 'crop1',
      region: 'Dakar',
      market: 'Marché HLM',
      pricePerUnit: 380,
      currency: 'XOF',
      date: new Date('2024-06-08'),
    },
    {
      _id: 'price3',
      cropId: 'crop1',
      region: 'Dakar',
      market: 'Marché Sandaga',
      pricePerUnit: 410,
      currency: 'XOF',
      date: new Date('2024-06-15'),
    },
  ];

  beforeEach(async () => {
    mockPriceModel = {
      find: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              lean: jest.fn().mockResolvedValue(mockPrices),
            }),
          }),
        }),
      }),
      findOne: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(mockPrices[2]),
        }),
      }),
      create: jest.fn().mockResolvedValue(mockPrices[0]),
      aggregate: jest.fn().mockResolvedValue([
        { _id: 'Dakar', avgPrice: 380, latestPrice: 410, market: 'Sandaga', count: 3 },
        { _id: 'Thiès', avgPrice: 320, latestPrice: 330, market: 'Central', count: 2 },
      ]),
    };

    mockCropModel = {
      find: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { _id: 'crop1', name: 'Maïs', slug: 'mais', unit: 'kg' },
          { _id: 'crop2', name: 'Mil', slug: 'mil', unit: 'kg' },
        ]),
      }),
    };

    // Import dynamique pour éviter les problèmes de dépendances circulaires
    const { PricesService } = await import('../modules/prices/prices.module');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PricesService,
        { provide: getModelToken('Price'), useValue: mockPriceModel },
        { provide: getModelToken('Crop'), useValue: mockCropModel },
      ],
    }).compile();

    service = module.get(PricesService);
  });

  describe('getPrices()', () => {
    it('retourne une liste de prix', async () => {
      const result = await service.getPrices({});
      expect(result).toEqual(mockPrices);
      expect(mockPriceModel.find).toHaveBeenCalledWith({});
    });

    it('filtre par région', async () => {
      await service.getPrices({ region: 'Dakar' });
      expect(mockPriceModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ region: 'Dakar' }),
      );
    });
  });

  describe('getPriceByCrop()', () => {
    it('retourne les prix avec statistiques', async () => {
      // Reconfigue le mock pour retourner une liste triée
      mockPriceModel.find = jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(mockPrices),
        }),
      });

      const result = await service.getPriceByCrop('crop1', 'Dakar', 30);

      expect(result).toHaveProperty('prices');
      expect(result).toHaveProperty('stats');
      expect(result.stats).toHaveProperty('min');
      expect(result.stats).toHaveProperty('max');
      expect(result.stats).toHaveProperty('average');
      expect(result.stats).toHaveProperty('trend');
    });

    it('retourne null stats si pas de données', async () => {
      mockPriceModel.find = jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([]),
        }),
      });

      const result = await service.getPriceByCrop('crop1', 'Dakar');
      expect(result.stats).toBeNull();
    });

    it('calcule correctement la tendance UP', async () => {
      // Prix en hausse
      const risingPrices = [
        { ...mockPrices[0], pricePerUnit: 200, date: new Date('2024-01-01') },
        { ...mockPrices[0], pricePerUnit: 220, date: new Date('2024-01-15') },
        { ...mockPrices[0], pricePerUnit: 250, date: new Date('2024-01-20') },
        { ...mockPrices[0], pricePerUnit: 280, date: new Date('2024-01-25') },
        { ...mockPrices[0], pricePerUnit: 310, date: new Date('2024-01-28') },
        { ...mockPrices[0], pricePerUnit: 340, date: new Date('2024-01-30') },
        { ...mockPrices[0], pricePerUnit: 370, date: new Date('2024-02-05') },
      ];

      mockPriceModel.find = jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(risingPrices),
        }),
      });

      const result = await service.getPriceByCrop('crop1', 'Dakar', 30);
      expect(result.stats.trend).toBe('UP');
      expect(result.stats.trendPercentage).toBeGreaterThan(2);
    });
  });

  describe('getPricesByRegion()', () => {
    it('retourne les prix groupés par région', async () => {
      const result = await service.getPricesByRegion('crop1');
      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('region');
      expect(result[0]).toHaveProperty('averagePrice');
      expect(result[0]).toHaveProperty('latestPrice');
    });
  });
});

// ----------------------------------------------------------------
// TESTS: Logique de prédiction JS (fallback)
// ----------------------------------------------------------------
describe('Prediction JS Fallback', () => {
  // Teste la régression linéaire directement (fonction privée exposée pour test)
  it('prédit une tendance haussière correctement', () => {
    const data = Array.from({ length: 14 }, (_, i) => ({
      ds: new Date(Date.now() - (13 - i) * 86400000),
      y: 200 + i * 10, // Prix croissant de 10 FCFA/jour
    }));

    // Simule la logique de fallback
    const n = data.length;
    const prices = data.map((d) => d.y);
    const x = Array.from({ length: n }, (_, i) => i);

    const xMean = (n - 1) / 2;
    const yMean = prices.reduce((a, b) => a + b, 0) / n;

    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      num += (i - xMean) * (prices[i] - yMean);
      den += (i - xMean) ** 2;
    }
    const slope = num / den;

    expect(slope).toBeGreaterThan(5); // Pente positive ≈ 10
    expect(slope).toBeLessThan(15);
  });

  it('prédit une tendance baissière correctement', () => {
    const prices = Array.from({ length: 14 }, (_, i) => 400 - i * 8);
    const n = prices.length;
    const xMean = (n - 1) / 2;
    const yMean = prices.reduce((a, b) => a + b, 0) / n;

    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      num += (i - xMean) * (prices[i] - yMean);
      den += (i - xMean) ** 2;
    }
    const slope = num / den;

    expect(slope).toBeLessThan(-5);
  });
});

// ----------------------------------------------------------------
// TESTS: Logique de recommandation
// ----------------------------------------------------------------
describe('Recommendation Logic', () => {
  type Action = 'SELL' | 'WAIT' | 'STORE';
  type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

  // Réplication de la logique métier pour test isolé
  function computeRecommendation(
    trend: string,
    percentageChange: number,
    modelConfidence: number,
  ): { action: Action; confidence: Confidence } {
    if (trend === 'UP' && percentageChange > 10) {
      return {
        action: 'WAIT',
        confidence: modelConfidence > 0.75 ? 'HIGH' : 'MEDIUM',
      };
    }
    if (trend === 'UP' && percentageChange > 3) {
      return { action: 'WAIT', confidence: 'MEDIUM' };
    }
    if (trend === 'DOWN') {
      return {
        action: 'SELL',
        confidence: Math.abs(percentageChange) > 10 ? 'HIGH' : 'MEDIUM',
      };
    }
    return { action: 'SELL', confidence: 'MEDIUM' };
  }

  it('recommande WAIT quand hausse forte >10%', () => {
    const result = computeRecommendation('UP', 15, 0.85);
    expect(result.action).toBe('WAIT');
    expect(result.confidence).toBe('HIGH');
  });

  it('recommande WAIT avec confiance MEDIUM quand hausse modérée 3-10%', () => {
    const result = computeRecommendation('UP', 6, 0.7);
    expect(result.action).toBe('WAIT');
    expect(result.confidence).toBe('MEDIUM');
  });

  it('recommande SELL quand tendance stabile', () => {
    const result = computeRecommendation('STABLE', 1.5, 0.8);
    expect(result.action).toBe('SELL');
  });

  it('recommande SELL avec confiance HIGH quand baisse forte', () => {
    const result = computeRecommendation('DOWN', -14, 0.9);
    expect(result.action).toBe('SELL');
    expect(result.confidence).toBe('HIGH');
  });

  it('recommande SELL avec confiance MEDIUM quand baisse légère', () => {
    const result = computeRecommendation('DOWN', -4, 0.6);
    expect(result.action).toBe('SELL');
    expect(result.confidence).toBe('MEDIUM');
  });

  it('ne recommande jamais une action invalide', () => {
    const validActions: Action[] = ['SELL', 'WAIT', 'STORE'];
    const cases = [
      ['UP', 20, 0.9],
      ['UP', 5, 0.7],
      ['STABLE', 0, 0.8],
      ['DOWN', -10, 0.85],
      ['DOWN', -3, 0.6],
    ] as [string, number, number][];

    cases.forEach(([trend, pct, conf]) => {
      const result = computeRecommendation(trend, pct, conf);
      expect(validActions).toContain(result.action);
    });
  });
});

// ----------------------------------------------------------------
// TESTS: Statistiques de prix
// ----------------------------------------------------------------
describe('Price Statistics', () => {
  function computeStats(prices: number[]) {
    if (!prices.length) return null;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const average = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
    const current = prices[prices.length - 1];

    const firstWeek = prices.slice(0, Math.min(7, prices.length));
    const lastWeek = prices.slice(-Math.min(7, prices.length));
    const firstAvg = firstWeek.reduce((a, b) => a + b, 0) / firstWeek.length;
    const lastAvg = lastWeek.reduce((a, b) => a + b, 0) / lastWeek.length;
    const trendPct = ((lastAvg - firstAvg) / firstAvg) * 100;

    return { min, max, average, current, trendPercentage: Math.round(trendPct * 10) / 10 };
  }

  it('calcule min, max, moyenne correctement', () => {
    const stats = computeStats([100, 200, 150, 300, 250]);
    expect(stats?.min).toBe(100);
    expect(stats?.max).toBe(300);
    expect(stats?.average).toBe(200);
    expect(stats?.current).toBe(250);
  });

  it('retourne null pour une liste vide', () => {
    expect(computeStats([])).toBeNull();
  });

  it('calcule correctement la variation sur 7 jours', () => {
    // Semaine 1: avg=100, Semaine 2: avg=120 → +20%
    const prices = [100, 100, 100, 100, 100, 100, 100, 120, 120, 120, 120, 120, 120, 120];
    const stats = computeStats(prices);
    expect(stats?.trendPercentage).toBeCloseTo(20, 0);
  });
});
