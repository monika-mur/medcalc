export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      dosage_changes: {
        Row: {
          daily_dosage: number
          effective_date: string
          id: string
          medication_id: string
          recorded_at: string
          user_id: string
        }
        Insert: {
          daily_dosage: number
          effective_date: string
          id?: string
          medication_id: string
          recorded_at?: string
          user_id?: string
        }
        Update: {
          daily_dosage?: number
          effective_date?: string
          id?: string
          medication_id?: string
          recorded_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dosage_changes_medication_fk"
            columns: ["medication_id", "user_id"]
            isOneToOne: false
            referencedRelation: "medications"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      medications: {
        Row: {
          archived_at: string | null
          container_capacity: number | null
          created_at: string
          estimated_daily_consumption: number | null
          expiry_date: string
          form: Database["public"]["Enums"]["medication_form"]
          id: string
          name: string
          opened_on: string | null
          post_opening_expiry_days: number | null
          specialist_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          container_capacity?: number | null
          created_at?: string
          estimated_daily_consumption?: number | null
          expiry_date: string
          form?: Database["public"]["Enums"]["medication_form"]
          id?: string
          name: string
          opened_on?: string | null
          post_opening_expiry_days?: number | null
          specialist_id: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          archived_at?: string | null
          container_capacity?: number | null
          created_at?: string
          estimated_daily_consumption?: number | null
          expiry_date?: string
          form?: Database["public"]["Enums"]["medication_form"]
          id?: string
          name?: string
          opened_on?: string | null
          post_opening_expiry_days?: number | null
          specialist_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "medications_specialist_fk"
            columns: ["specialist_id", "user_id"]
            isOneToOne: false
            referencedRelation: "specialists"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      specialists: {
        Row: {
          created_at: string
          id: string
          name: string
          specialty: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          specialty: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          specialty?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      supply_events: {
        Row: {
          counted_quantity: number | null
          event_type: Database["public"]["Enums"]["supply_event_type"]
          id: string
          medication_id: string
          note: string | null
          occurred_on: string
          projected_quantity: number | null
          quantity_delta: number
          recorded_at: string
          user_id: string
        }
        Insert: {
          counted_quantity?: number | null
          event_type: Database["public"]["Enums"]["supply_event_type"]
          id?: string
          medication_id: string
          note?: string | null
          occurred_on: string
          projected_quantity?: number | null
          quantity_delta: number
          recorded_at?: string
          user_id?: string
        }
        Update: {
          counted_quantity?: number | null
          event_type?: Database["public"]["Enums"]["supply_event_type"]
          id?: string
          medication_id?: string
          note?: string | null
          occurred_on?: string
          projected_quantity?: number | null
          quantity_delta?: number
          recorded_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supply_events_medication_fk"
            columns: ["medication_id", "user_id"]
            isOneToOne: false
            referencedRelation: "medications"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      visits: {
        Row: {
          created_at: string
          id: string
          specialist_id: string
          updated_at: string
          user_id: string
          visit_date: string
        }
        Insert: {
          created_at?: string
          id?: string
          specialist_id: string
          updated_at?: string
          user_id?: string
          visit_date: string
        }
        Update: {
          created_at?: string
          id?: string
          specialist_id?: string
          updated_at?: string
          user_id?: string
          visit_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "visits_specialist_fk"
            columns: ["specialist_id", "user_id"]
            isOneToOne: false
            referencedRelation: "specialists"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      medication_form: "solid" | "liquid"
      supply_event_type: "refill" | "recount" | "adjustment"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      medication_form: ["solid", "liquid"],
      supply_event_type: ["refill", "recount", "adjustment"],
    },
  },
} as const

