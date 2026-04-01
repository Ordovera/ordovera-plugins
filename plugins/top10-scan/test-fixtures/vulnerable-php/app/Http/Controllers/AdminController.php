<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AdminController extends Controller
{
    // A01: No auth check, no admin role verification
    public function listUsers()
    {
        // Returns all users including password hashes
        $users = DB::table('users')->get();
        return response()->json($users);
    }

    // A01: No auth check on destructive action
    // A09: No audit logging of user deletion
    public function deleteUser($id)
    {
        DB::table('users')->where('id', $id)->delete();
        return response()->json(['message' => 'User deleted']);
    }

    // A01: No auth check on sensitive logs
    public function viewLogs()
    {
        $logs = DB::table('audit_logs')->get();
        return response()->json($logs);
    }
}
