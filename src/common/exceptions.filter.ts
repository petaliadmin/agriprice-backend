// =============================================================
// EXCEPTION FILTER GLOBAL — Format d'erreur unifié
// Toutes les erreurs de l'API suivent le même format JSON
// =============================================================

import {
  ExceptionFilter, Catch, ArgumentsHost,
  HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Une erreur interne est survenue';
    let details: any = undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        const resp = exceptionResponse as any;
        message = resp.message || message;
        details = resp.errors || undefined;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    // Log des erreurs 5xx
    if (status >= 500) {
      this.logger.error(
        `[${request.method}] ${request.url} → ${status}: ${message}`,
        exception instanceof Error ? exception.stack : '',
      );
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      message,
      details,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}

// ---- Enregistrement dans main.ts ----
/*
import { AllExceptionsFilter } from './common/exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new AllExceptionsFilter());
  // ...
}
*/
