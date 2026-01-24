import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AccountsService } from './accounts.service.js';
import { CreateAccountDto } from './dto/create-account.dto.js';
import { AccountResponseDto } from './dto/account-response.dto.js';

@ApiTags('accounts')
@Controller('accounts')
@UseGuards(ThrottlerGuard)
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Post()
  @ApiOperation({ summary: 'Create ephemeral account' })
  @ApiResponse({
    status: 201,
    description: 'Account created',
    type: AccountResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiBearerAuth()
  public async create(
    @Body() createAccountDto: CreateAccountDto,
  ): Promise<AccountResponseDto> {
    return this.accountsService.create(createAccountDto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get account by ID' })
  @ApiResponse({
    status: 200,
    description: 'Account details',
    type: AccountResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Account not found' })
  public async findOne(@Param('id') id: string): Promise<AccountResponseDto> {
    return this.accountsService.findOne(id);
  }

  @Get()
  @ApiOperation({ summary: 'List accounts' })
  @ApiResponse({ status: 200, description: 'List of accounts' })
  public async findAll(
    @Query('status') status?: string,
    @Query('limit') limit = 50,
    @Query('offset') offset = 0,
  ) {
    return this.accountsService.findAll({ status, limit, offset });
  }
}
