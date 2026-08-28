import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000', credentials: true });
  app.setGlobalPrefix('api/v1', {
    exclude: ['health', 'openapi.json', 'reference'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  const openApiConfig = new DocumentBuilder()
    .setTitle('Gatherly API')
    .setDescription('API contract for the Gatherly community event platform.')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const openApiDocument = SwaggerModule.createDocument(app, openApiConfig);

  SwaggerModule.setup('openapi', app, openApiDocument, {
    ui: false,
    raw: ['json'],
    jsonDocumentUrl: 'openapi.json',
  });
  app.use(
    '/reference',
    apiReference({
      content: openApiDocument,
      title: 'Gatherly API Reference',
      layout: 'modern',
      darkMode: false,
    }),
  );

  await app.listen(process.env.PORT ?? 3001);
}

void bootstrap();
