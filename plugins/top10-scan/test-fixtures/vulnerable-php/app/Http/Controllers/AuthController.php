<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AuthController extends Controller
{
    public function login(Request $request)
    {
        $email = $request->input('email');
        $password = $request->input('password');

        // A04: SHA1 for password comparison instead of bcrypt
        $hashed = sha1($password);

        $user = DB::table('users')
            ->where('email', $email)
            ->where('password', $hashed)
            ->first();

        if (!$user) {
            // A09: No logging of failed login attempt
            return response()->json(['error' => 'Invalid credentials'], 401);
        }

        // A04: Weak session token generation using mt_rand
        $token = md5(mt_rand() . time() . $email);

        DB::table('sessions')->insert([
            'user_id' => $user->id,
            'token' => $token,
        ]);

        return response()->json(['token' => $token]);
    }

    public function register(Request $request)
    {
        $email = $request->input('email');
        $password = $request->input('password');
        $name = $request->input('name');

        // A04: SHA1 for password storage
        $hashed = sha1($password);

        DB::table('users')->insert([
            'name' => $name,
            'email' => $email,
            'password' => $hashed,
        ]);

        return response()->json(['message' => 'User created'], 201);
    }
}
