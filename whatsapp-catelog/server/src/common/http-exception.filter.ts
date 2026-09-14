import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

/**
 * One consistent error envelope: { statusCode, message, code? }.
 *
 * Unexpected errors are logged in full but reported generically, so database
 * internals and raw Meta Graph payloads never leak to the browser.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse() as any;
      const body =
        typeof payload === 'string'
          ? { statusCode: status, message: payload }
          : { statusCode: status, ...payload };

      // class-validator returns message as an array; keep the first line.
      if (Array.isArray(body.message)) body.message = body.message[0];
      return res.status(status).json(body);
    }

    this.logger.error(
      `Unhandled error: ${(exception as Error)?.message}`,
      (exception as Error)?.stack,
    );
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      message: 'Something went wrong. Please try again.',
    });
  }
}
