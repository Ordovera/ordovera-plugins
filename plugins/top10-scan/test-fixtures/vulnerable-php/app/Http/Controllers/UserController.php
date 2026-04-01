<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class UserController extends Controller
{
    public function show($id)
    {
        // A05: Raw SQL with string concatenation
        $user = DB::select("SELECT * FROM users WHERE id = " . $id);

        if (empty($user)) {
            return response()->json(['error' => 'Not found'], 404);
        }

        // A05: Unescaped output - returns raw HTML-capable fields
        return response()->json($user[0]);
    }

    public function update($id, Request $request)
    {
        $name = $request->input('name');
        $bio = $request->input('bio');

        // A05: Raw SQL with string concatenation
        DB::statement("UPDATE users SET name = '" . $name . "', bio = '" . $bio . "' WHERE id = " . $id);

        // A01: No ownership check - any user can update any profile
        return response()->json(['message' => 'Updated']);
    }
}
