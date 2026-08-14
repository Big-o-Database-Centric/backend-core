import { ApiProperty } from "@nestjs/swagger";
import { IsEmail,IsString, MinLength } from "class-validator";

export class LoginDto {
    @ApiProperty({
        example: 'jerogallego@gmail.com',
        description: "User email."
    })
    @IsEmail()
    email: string;

    @ApiProperty({
        example: "Jeronimo12345",
        description: "User password"
    })
    @IsString()
    @MinLength(8)
    password: string;
}