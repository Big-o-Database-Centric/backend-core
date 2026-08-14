import { Body, Controller, Get, Inject, Post } from '@nestjs/common';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import type { IAuthRepository } from './interfaces/auth.repository.interface';
import { ApiResponse as ApiResponseDto } from 'src/common/responses/api.response';
import { ApiOperation, ApiTags, ApiResponse } from '@nestjs/swagger';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
    constructor(
        @Inject('IAuthRepository') private readonly _authRepository: IAuthRepository,
    ) {}

    @ApiOperation({
        summary: 'Login a new user'
    })
    @ApiResponse({
        status: 200,
        description: 'User logged successfully'
    })
    @ApiResponse({
        status: 401,
        description: 'Invalid credentials'
    })
    @Post('login')
    async login(@Body() dto: LoginDto) {
        // Passing it to db
        const result = await this._authRepository.login(dto);

        // Returning response
        return new ApiResponseDto(
            200,
            "User logged successfully",
            result
        );
    }

    @ApiOperation({
        summary: 'Register a new user'
    })
    @ApiResponse({
        status: 201,
        description: 'User created successfully'
    })
    @ApiResponse({
        status: 409,
        description: 'Email already exists'
    })
    @Post('register')
    async register(@Body() dto: RegisterDto) {
        // Passing to database
        const result = await this._authRepository.register(dto);

        return new ApiResponseDto(
            201,
            "User registered successfully",
            result
        );
    }
}
