<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\UserController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\AdminController;

Route::post('/login', [AuthController::class, 'login']);
Route::post('/register', [AuthController::class, 'register']);

// A01: No auth middleware on user profile - anyone can view/edit any user
Route::get('/users/{id}', [UserController::class, 'show']);
Route::put('/users/{id}', [UserController::class, 'update']);

// A01: Admin routes without auth middleware
Route::get('/admin/users', [AdminController::class, 'listUsers']);
Route::delete('/admin/users/{id}', [AdminController::class, 'deleteUser']);
Route::get('/admin/logs', [AdminController::class, 'viewLogs']);
