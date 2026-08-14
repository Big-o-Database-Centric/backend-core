import { HttpStatus } from "@nestjs/common";

export const SqlErrorMap = new Map<number, HttpStatus>([
    [50001, HttpStatus.CONFLICT],
    [50002, HttpStatus.NOT_FOUND],
    [50003, HttpStatus.UNAUTHORIZED],
    [50004, HttpStatus.FORBIDDEN],
    [50005, HttpStatus.BAD_REQUEST]
])