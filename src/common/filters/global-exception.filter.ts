import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiResponse } from '../responses/api.response';
import { SqlErrorMap } from '../constants/sql-error-map.constant';

@Catch() // -> This filters catch exceptions | Catch(ConflictException) for catch only conflicts
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    // ArgumentsHost -> represents the actual request context.

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal Server Error';
    let errors: string[] = [];

    // Checking if the exception comes up from sql server. Exception must be an object, different of null and with a number property
    if (
      typeof exception === 'object' &&
      exception !== null &&
      'number' in exception
    ) {
      const sqlException = exception as {
        // as means: manage this var like it is as this type
        number: number;
        message: string;
      };

      status =
        SqlErrorMap.get(sqlException.number) ??
        HttpStatus.INTERNAL_SERVER_ERROR;
      message = sqlException.message;
    }

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = exception.message;

      const exceptionResponse = exception.getResponse();

      if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null &&
        'error' in exceptionResponse
      ) {
        response.status(status).json(exceptionResponse);
        return;
      }

      // If the errors is of validation
      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const exceptionBody = exceptionResponse as {
          message: string | string[];
        };

        if (Array.isArray(exceptionBody.message))
          errors = exceptionBody.message;
      }
    }

    response
      .status(status)
      .json(new ApiResponse(status, message, null, errors));
  }
}
