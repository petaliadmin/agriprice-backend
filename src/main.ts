import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  // Validation globale des DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // CORS pour le développement
  app.enableCors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: '*',
    credentials: false,
  });

  // Préfixe global de l'API
  app.setGlobalPrefix('api/v1');

  // Configuration Swagger / OpenAPI
  const config = new DocumentBuilder()
    .setTitle('AgriPrix API')
    .setDescription("API de prédiction des prix agricoles pour les agriculteurs africains")
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('auth', 'Authentification')
    .addTag('crops', 'Cultures agricoles')
    .addTag('prices', 'Prix du marché')
    .addTag('predictions', 'Prédictions IA')
    .addTag('recommendations', 'Recommandations')
    .addTag('alerts', 'Alertes de prix')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.log(`🌾 AgriPrix API démarrée sur le port ${port}`);
  logger.log(`📚 Documentation: http://localhost:${port}/api/docs`);
}
bootstrap();
