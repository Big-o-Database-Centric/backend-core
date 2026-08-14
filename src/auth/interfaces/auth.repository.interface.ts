import { LoginDto } from "../dto/login.dto";
import { RegisterDto } from "../dto/register.dto";

export interface IAuthRepository {
    register(dto: RegisterDto): Promise<any>;
    login(dto: LoginDto): Promise<any>;
}