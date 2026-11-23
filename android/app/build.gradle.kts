plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.familia.financas"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.familia.financas"
        minSdk = 26 // Android 8.0+ (Decisão E8-D2)
        targetSdk = 35 // Android 15
        versionCode = 1
        versionName = "1.0.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    // App ultraleve usando apenas APIs nativas do Android SDK (zero bibliotecas de terceiros).
}
